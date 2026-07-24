import { createRouter, globals } from 'tinybubble';

const tinyRouter = createRouter({
  mode: 'history',
  routes: [
    { path: '/' },
    { path: '/c/:id' },
  ]
});

function currentRoute() {
  const path = window.location.pathname || '/';
  const match = path.match(/^\/c\/([^/]+)$/);
  const params = match ? { id: decodeURIComponent(match[1]) } : {};
  return {
    path,
    params,
    query: Object.fromEntries(new URLSearchParams(window.location.search))
  };
}

function syncRoute() {
  globals.$route.value = currentRoute();
}

export const router = {
  ...tinyRouter,
  start() {
    syncRoute();
    window.addEventListener('popstate', syncRoute);
  },
  navigate(to) {
    tinyRouter.navigate(to);
    syncRoute();
  }
};
