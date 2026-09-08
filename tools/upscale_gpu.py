"""
高清化预处理 v8 — GPU 加速（CuPy / CUDA）
==========================================
LANCZOS3 高质量重采样放大 + 原图调色板吸附，全部在 GPU 上执行：
  - LANCZOS3 separable 卷积（水平/垂直两个 CUDA kernel，坐标约定对齐 PIL）
  - 调色板最近色吸附（每像素遍历调色板，GPU 并行）
  - alpha: hard 模式二值化（无渐变，默认）/ soft 模式保留 LANCZOS 渐变

用法：
  python tools/upscale_gpu.py                       # 全量 97 张（hard alpha）
  python tools/upscale_gpu.py player/player_walk1.png        # 单张 hard
  python tools/upscale_gpu.py player/player_walk1.png soft   # 单张 soft
  python tools/upscale_gpu.py --soft                # 全量 soft alpha
无 GPU / CuPy 时自动回退到 CPU 版 upscale_lanczos.py。
"""

import os, sys, glob, time

ROOT = os.path.join(os.path.dirname(__file__), '..', 'new', 'assets', 'sprites')
ORIG_ROOT = os.path.join(os.path.dirname(__file__), '..', 'new', 'assets', 'sprites_original')
TARGET_MAX = 3840
SKIP = {'_contact_sheet.png'}


# ---------- CUDA DLL 引导（pip 版 nvidia-cuda-* 包）----------
def _bootstrap_cuda_dlls():
    site = os.path.join(sys.prefix, 'Lib', 'site-packages', 'nvidia')
    if not os.path.isdir(site):
        # user site 兜底
        import site as _s
        for d in _s.getsitepackages() + [_s.getusersitepackages()]:
            cand = os.path.join(d, 'nvidia')
            if os.path.isdir(cand):
                site = cand
                break
    if not os.path.isdir(site):
        return
    import ctypes
    for dll in glob.glob(os.path.join(site, '*', 'bin', '*.dll')):
        try:
            os.add_dll_directory(os.path.dirname(dll))
        except Exception:
            pass
    # 按依赖顺序用绝对路径预加载，保证 nvrtc 能找到同目录 builtins
    for name in ('cudart64_12.dll', 'nvrtc-builtins64_123.dll', 'nvrtc64_120_0.dll'):
        hits = glob.glob(os.path.join(site, '*', 'bin', name))
        if hits:
            try:
                ctypes.CDLL(hits[0])
            except OSError:
                pass


_bootstrap_cuda_dlls()

try:
    import numpy as np
    from PIL import Image
    import cupy as cp
    GPU_OK = True
except Exception as e:  # pragma: no cover
    GPU_OK = False
    _GPU_ERR = e


# ---------- CUDA kernels ----------
_KERNEL_SRC = r'''
extern "C" {

__device__ __forceinline__ float sincf_(float x) {
    if (fabsf(x) < 1e-6f) return 1.0f;
    float px = 3.14159265358979323846f * x;
    return sinf(px) / px;
}
__device__ __forceinline__ float lanczos3(float x) {
    if (fabsf(x) >= 3.0f) return 0.0f;
    return sincf_(x) * sincf_(x * 0.3333333333f);
}

// 水平重采样: in(H, Win, 4) -> out(H, Wout, 4)，RGBA float32
__global__ void lanczos_h(const float* in, float* out,
                          int H, int Win, int Wout) {
    int x = blockIdx.x * blockDim.x + threadIdx.x;
    int y = blockIdx.y * blockDim.y + threadIdx.y;
    if (x >= Wout || y >= H) return;
    float center = ((float)x + 0.5f) * (float)Win / (float)Wout - 0.5f;
    int left  = (int)ceilf(center - 3.0f);
    int right = (int)floorf(center + 3.0f);
    float s0=0,s1=0,s2=0,s3=0, wsum=0;
    for (int i = left; i <= right; i++) {
        int ix = i < 0 ? 0 : (i >= Win ? Win-1 : i);
        float w = lanczos3((float)i - center);
        wsum += w;
        const float* p = in + (y * Win + ix) * 4;
        s0 += w*p[0]; s1 += w*p[1]; s2 += w*p[2]; s3 += w*p[3];
    }
    float* o = out + (y * Wout + x) * 4;
    float inv = 1.0f / wsum;
    o[0]=s0*inv; o[1]=s1*inv; o[2]=s2*inv; o[3]=s3*inv;
}

// 垂直重采样: in(Hin, W, 4) -> out(Hout, W, 4)
__global__ void lanczos_v(const float* in, float* out,
                          int Hin, int Hout, int W) {
    int x = blockIdx.x * blockDim.x + threadIdx.x;
    int y = blockIdx.y * blockDim.y + threadIdx.y;
    if (x >= W || y >= Hout) return;
    float center = ((float)y + 0.5f) * (float)Hin / (float)Hout - 0.5f;
    int top    = (int)ceilf(center - 3.0f);
    int bottom = (int)floorf(center + 3.0f);
    float s0=0,s1=0,s2=0,s3=0, wsum=0;
    for (int j = top; j <= bottom; j++) {
        int jy = j < 0 ? 0 : (j >= Hin ? Hin-1 : j);
        float w = lanczos3((float)j - center);
        wsum += w;
        const float* p = in + (jy * W + x) * 4;
        s0 += w*p[0]; s1 += w*p[1]; s2 += w*p[2]; s3 += w*p[3];
    }
    float* o = out + (y * W + x) * 4;
    float inv = 1.0f / wsum;
    o[0]=s0*inv; o[1]=s1*inv; o[2]=s2*inv; o[3]=s3*inv;
}

// alpha 二值化 + RGB 吸附到最近调色板颜色
// img: N×4 float; pal: P×3 float; npal: 调色板颜色数
__global__ void snap(float* img, const float* pal, int npal,
                     int hard, float athresh, int total) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i >= total) return;
    float* px = img + i*4;
    float a = px[3];
    if (hard) a = (a > athresh) ? 255.0f : 0.0f;
    else      a = a < 0 ? 0 : (a > 255 ? 255 : a);
    px[3] = a;
    if (a <= 0.0f) { px[0]=0; px[1]=0; px[2]=0; return; }
    float bd = 1e30f; int bi = 0;
    for (int j = 0; j < npal; j++) {
        float dr = px[0]-pal[j*3], dg = px[1]-pal[j*3+1], db = px[2]-pal[j*3+2];
        float d = dr*dr + dg*dg + db*db;
        if (d < bd) { bd = d; bi = j; }
    }
    px[0]=pal[bi*3]; px[1]=pal[bi*3+1]; px[2]=pal[bi*3+2];
}

}  // extern "C"
'''

_mod = None
def _get_kernels():
    global _mod
    if _mod is None:
        _mod = cp.RawModule(code=_KERNEL_SRC, options=('-std=c++11',))
    return (_mod.get_function('lanczos_h'),
            _mod.get_function('lanczos_v'),
            _mod.get_function('snap'))


_BLK = (16, 16)

def process_gpu(img_path, hard_alpha=True, alpha_thresh=128.0):
    orig_path = os.path.join(ORIG_ROOT, os.path.relpath(img_path, ROOT))
    if not os.path.exists(orig_path):
        orig_path = img_path
    im = Image.open(orig_path).convert('RGBA')
    w, h = im.size

    arr0 = np.array(im)
    opaque = arr0[arr0[:, :, 3] > 0]
    if len(opaque) == 0:
        return im
    palette = np.unique(opaque.reshape(-1, 4), axis=0)[:, :3].astype(np.float32)

    k = TARGET_MAX / max(w, h)
    Wout, Hout = max(1, round(w*k)), max(1, round(h*k))

    # 上传原图（NCHW 风格展平 H×W×4）
    d_in = cp.asarray(arr0.astype(np.float32).reshape(-1))
    d_tmp = cp.empty(h * Wout * 4, dtype=cp.float32)
    d_out = cp.empty(Hout * Wout * 4, dtype=cp.float32)
    d_pal = cp.asarray(palette.reshape(-1))

    kh, kv, ksnap = _get_kernels()

    grid_h = ((Wout + 15)//16, (h + 15)//16)
    grid_v = ((Wout + 15)//16, (Hout + 15)//16)
    kh(tuple(grid_h), _BLK, (d_in, d_tmp, np.int32(h), np.int32(w), np.int32(Wout)))
    kv(tuple(grid_v), _BLK, (d_tmp, d_out, np.int32(h), np.int32(Hout), np.int32(Wout)))

    total = Hout * Wout
    grid_s = ((total + 255)//256,)
    ksnap(grid_s, (256,), (d_out, d_pal, np.int32(len(palette)),
                           np.int32(1 if hard_alpha else 0),
                           np.float32(alpha_thresh), np.int32(total)))

    out = cp.asnumpy(d_out).reshape(Hout, Wout, 4)
    return Image.fromarray(out.astype(np.uint8), 'RGBA')


def process_cpu(img_path, hard_alpha):
    sys.path.insert(0, os.path.dirname(__file__))
    import upscale_lanczos as cpu
    return cpu.process(img_path, hard_alpha=hard_alpha)


def main():
    if not GPU_OK:
        print('!! GPU 不可用 (%s)，回退 CPU 版 upscale_lanczos.py' % _GPU_ERR)
        os.system('python "%s" %s' % (
            os.path.join(os.path.dirname(__file__), 'upscale_lanczos.py'),
            ' '.join(sys.argv[1:])))
        return

    args = sys.argv[1:]
    hard = 'soft' not in args
    args = [a for a in args if a not in ('hard', 'soft')]

    targets = []
    if args:
        rel = args[0].replace('\\', '/').lstrip('/')
        targets = [os.path.join(ROOT, rel)]
    else:
        for root, dirs, files in os.walk(ROOT):
            for fn in files:
                if fn.lower().endswith('.png') and fn not in SKIP:
                    targets.append(os.path.join(root, fn))

    print('GPU: %s | mode: %s' % (
        cp.cuda.runtime.getDeviceProperties(0)['name'].decode(),
        'HARD-alpha' if hard else 'soft-alpha'))

    count = 0
    t0 = time.time()
    for path in targets:
        t1 = time.time()
        try:
            out = process_gpu(path, hard_alpha=hard)
            out.save(path, 'PNG', optimize=False)
            count += 1
            rel = os.path.relpath(path, ROOT)
            print('  [%3d] %-42s -> %dx%d  %.2fs' % (
                count, rel, out.size[0], out.size[1], time.time()-t1))
        except Exception as e:
            import traceback
            print('  ! FAIL %s: %s' % (os.path.relpath(path, ROOT), e))
            traceback.print_exc()

    print('\nDone. %d files in %.1fs (GPU).' % (count, time.time()-t0))


if __name__ == '__main__':
    main()
