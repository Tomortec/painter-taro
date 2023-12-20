let hexcase = 0;
let chrsz = 8;
export function hex_sha1(s) {
  return binb2hex(core_sha1(str2binb(s), s.length * chrsz));
}
function core_sha1(x, len) {
  x[len >> 5] |= 0x80 << 24 - len % 32;
  x[(len + 64 >> 9 << 4) + 15] = len;
  let w = Array(80);
  let a = 1732584193;
  let b = -271733879;
  let c = -1732584194;
  let d = 271733878;
  let e = -1009589776;
  for (let i = 0; i < x.length; i += 16) {
    let olda = a;
    let oldb = b;
    let oldc = c;
    let oldd = d;
    let olde = e;
    for (let j = 0; j < 80; j++) {
      if (j < 16) w[j] = x[i + j];else w[j] = rol(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
      let t = safe_add(safe_add(rol(a, 5), sha1_ft(j, b, c, d)), safe_add(safe_add(e, w[j]), sha1_kt(j)));
      e = d;
      d = c;
      c = rol(b, 30);
      b = a;
      a = t;
    }
    a = safe_add(a, olda);
    b = safe_add(b, oldb);
    c = safe_add(c, oldc);
    d = safe_add(d, oldd);
    e = safe_add(e, olde);
  }
  return Array(a, b, c, d, e);
}
function sha1_ft(t, b, c, d) {
  if (t < 20) return b & c | ~b & d;
  if (t < 40) return b ^ c ^ d;
  if (t < 60) return b & c | b & d | c & d;
  return b ^ c ^ d;
}
function sha1_kt(t) {
  return t < 20 ? 1518500249 : t < 40 ? 1859775393 : t < 60 ? -1894007588 : -899497514;
}
function safe_add(x, y) {
  let lsw = (x & 0xffff) + (y & 0xffff);
  let msw = (x >> 16) + (y >> 16) + (lsw >> 16);
  return msw << 16 | lsw & 0xffff;
}
function rol(num, cnt) {
  return num << cnt | num >>> 32 - cnt;
}
function str2binb(str) {
  let bin = Array();
  let mask = 255;
  for (let i = 0; i < str.length * chrsz; i += chrsz) bin[i >> 5] |= (str.charCodeAt(i / chrsz) & mask) << 24 - i % 32;
  return bin;
}
function binb2hex(binarray) {
  let hex_tab = '0123456789abcdef';
  let str = '';
  for (let i = 0; i < binarray.length * 4; i++) {
    str += hex_tab.charAt(binarray[i >> 2] >> (3 - i % 4) * 8 + 4 & 0xf) + hex_tab.charAt(binarray[i >> 2] >> (3 - i % 4) * 8 & 0xf);
  }
  return str;
}