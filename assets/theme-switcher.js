(function () {
  var params = new URLSearchParams(window.location.search);
  var theme = (params.get('theme') || '').toLowerCase();
  var link = document.getElementById('theme-override');
  if (!link) return;

  if (theme === 'a') {
    link.href = 'assets/theme-a.css';
  } else if (theme === 'b') {
    link.href = 'assets/theme-b.css';
  } else {
    link.href = '';
  }
})();
