(function () {
        try {
          var t = localStorage.getItem("pithagoras.theme") || "system";
          var dark =
            t === "dark" ||
            (t === "system" && !matchMedia("(prefers-color-scheme: light)").matches);
          document.documentElement.dataset.theme = dark ? "dark" : "light";
          // The installed app's title bar, in --canvas from index.css. The tag
          // starts out dark.
          var meta = document.querySelector('meta[name="theme-color"]');
          if (meta && !dark) meta.content = "#fafafb";
          var bar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
          if (bar && !dark) bar.content = "default";
        } catch (e) {
          document.documentElement.dataset.theme = "dark";
        }
      })();
