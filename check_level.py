import base64, re
with open('new/stage11_data.js', 'r') as f:
    content = f.read()
b64 = re.search(r'"([^"]+)"', content).group(1)
data = base64.b64decode(b64)

# row 13 (ground top), columns 0-40
row12 = [data[12*1001 + c] for c in range(40)]
row13 = [data[13*1001 + c] for c in range(40)]
row14 = [data[14*1001 + c] for c in range(40)]
print('row12:', row12)
print('row13:', row13)
print('row14:', row14)

# Check for enemy triggers (bytes 50-79) in all rows, columns 0-40
print('--- triggers in cols 0-40 ---')
for r in range(17):
    for c in range(40):
        v = data[r*1001 + c]
        if 50 <= v <= 79:
            print(f'row={r} col={c} byte={v} btype={v-50}')
