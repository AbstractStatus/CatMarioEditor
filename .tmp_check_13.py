import json

with open(r'r:\PythonNewProcject\NewCatMarioEditor\stages_data.js', 'r', encoding='utf-8') as f:
    src = f.read()

i = src.find('window.STAGES')
j = src.find('=', i)
b = src.find('[', j)
depth = 0
end = b
for k in range(b, len(src)):
    if src[k] == '[':
        depth += 1
    elif src[k] == ']':
        depth -= 1
        if depth == 0:
            end = k + 1
            break

arr = json.loads(src[b:end])

for sid in ['1-2-1', '1-3']:
    s = [x for x in arr if x.get('id') == sid][0]
    print(f'=== {sid} ===')
    print(f'enemies count: {len(s["enemies"])}')
    for i, en in enumerate(s['enemies']):
        print(f'  enemies[{i}]: btype={en.get("btype")} bxtype={en.get("bxtype")} ba={en.get("ba")} bb={en.get("bb")} uid={en.get("uid")} events={en.get("events") is not None}')
    print(f'blocks count: {len(s["blocks"])}')
    for i, bk in enumerate(s['blocks']):
        col = round(bk['x'] / 29)
        row = round((bk['y'] + 12) / 29)
        marker = ''
        if sid == '1-3' and bk.get('type') == 1 and col == 22 and row == 3:
            marker = ' <-- 脆弱砖候选 (bm_1_3)'
        if sid == '1-3' and bk.get('type') == 300:
            marker = ' <-- 提示块 (b' + str(i) + ')'
        print(f'  blocks[{i}]: type={bk.get("type")} x={bk.get("x")} y={bk.get("y")} col={col} row={row}{marker}')
    print()
