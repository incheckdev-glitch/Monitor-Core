(function loadAdminOverrideAndBirthdayCelebration(){
  const version = '20260917-full2';
  const coreSrc = '/admin-override-core.js?v=' + version;
  const songSrc = '/birthday-song.js?v=' + version;
  const experienceSrc = '/birthday-experience.js?v=' + version;

  const appendScript = (src, onload) => {
    const script = document.createElement('script');
    script.src = src;
    if (onload) script.onload = onload;
    document.head.appendChild(script);
  };

  const loadAsync = () => {
    appendScript(coreSrc, () => {
      appendScript(songSrc, () => appendScript(experienceSrc));
    });
  };

  if (document.readyState === 'loading') {
    document.write('<script src="' + coreSrc + '"><\/script>');
    document.write('<script src="' + songSrc + '"><\/script>');
    document.write('<script src="' + experienceSrc + '"><\/script>');
  } else {
    loadAsync();
  }
})();
