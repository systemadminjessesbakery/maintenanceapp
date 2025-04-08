/**
 * Version check script to handle client-side cache busting
 * Add this to HTML files to force refresh when server version changes
 */
(function() {
  // Check version every 10 seconds
  const CHECK_INTERVAL = 10000;
  
  // Store current version
  let currentVersion = '';
  
  // Function to check server version
  function checkVersion() {
    fetch('/version.json?' + Date.now())
      .then(response => response.json())
      .then(data => {
        // First time, just store the version
        if (!currentVersion) {
          currentVersion = data.version;
          console.log('Initial version: ' + currentVersion);
          return;
        }
        
        // If version changed, reload the page
        if (data.version !== currentVersion) {
          console.log(`Server version changed: ${currentVersion} → ${data.version}`);
          localStorage.setItem('versionChange', JSON.stringify({
            oldVersion: currentVersion,
            newVersion: data.version,
            timestamp: new Date().toISOString()
          }));
          
          // Force reload from server, bypassing cache
          window.location.reload(true);
        }
      })
      .catch(err => console.error('Error checking version:', err));
  }
  
  // Check immediately and then at intervals
  checkVersion();
  setInterval(checkVersion, CHECK_INTERVAL);
  
  // Add this to all AJAX requests to bust cache
  (function(open) {
    XMLHttpRequest.prototype.open = function(method, url, async, user, pass) {
      // Add version to all AJAX URLs except version check itself
      if (!url.includes('version.json')) {
        const separator = url.includes('?') ? '&' : '?';
        url = `${url}${separator}_v=${currentVersion || Date.now()}`;
      }
      open.call(this, method, url, async, user, pass);
    };
  })(XMLHttpRequest.prototype.open);
  
  // Report if we reloaded due to version change
  document.addEventListener('DOMContentLoaded', function() {
    const versionChange = localStorage.getItem('versionChange');
    if (versionChange) {
      console.log('Page was reloaded due to version change:', JSON.parse(versionChange));
      localStorage.removeItem('versionChange');
    }
  });
})(); 