var fs = require('fs');
var src = fs.readFileSync('r:/PythonNewProcject/NewCatMarioEditor/new/stage11_data.js', 'utf8');
var m = src.match(/window\.STAGE11_IMAGE_B64\s*=\s*"([^"]+)"/);
var data = Buffer.from(m[1], 'base64');
var rows = 17, cols = 646;
var counts = {};
for (var y = 0; y < rows; y++) {
  for (var x = 0; x < cols; x++) {
    var v = data[y * cols + x];
    counts[v] = (counts[v] || 0) + 1;
  }
}
var out = [];
for (var k in counts) out.push(k + ':' + counts[k]);
console.log(out.sort(function(a,b){return parseInt(b.split(':')[1])-parseInt(a.split(':')[1])}).join('\n'));
