(function loadAdminOverrideAndBirthdaySong(){
  const coreSrc = '/admin-override-core.js?v=20260917-song2';
  const songSrc = '/birthday-song.js?v=20260917-song2';

  const loadAsync = () => {
    const core = document.createElement('script');
    core.src = coreSrc;
    core.onload = () => {
      const song = document.createElement('script');
      song.src = songSrc;
      document.head.appendChild(song);
    };
    document.head.appendChild(core);
  };

  if (document.readyState === 'loading') {
    document.write('<script src="' + coreSrc + '"><\\/script>');
    document.write('<script src="' + songSrc + '"><\\/script>');
  } else {
    loadAsync();
  }
})();
