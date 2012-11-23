var util = exports = module.exports = {};

util.toFixLenString = function(integer, length) {
  var str = integer.toString();
  var left = length - str.length;
  if (left > 0) {
    var arr = [];
    arr[left] = str;
    for (var i = left-1; i>=0; i--)
      arr[i] = 0;
    str = arr.join('');
  }
  return str;
}
