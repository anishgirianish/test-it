// Paste into the browser DevTools console on the page with the table.
// Reports why a `position: sticky` table header is not sticking.
//
// How to read the output:
//   Line 1 says position is not "sticky"
//     -> the CSS rule is not reaching the <thead>: the class is missing, the
//        <thead> is rendered by another component (scoped styles skip it), or
//        another rule wins.
//   Line 1 says "sticky", line 2 is NOT the scroll container
//     -> a wrapper between the header and the scroll container has `overflow`
//        set, and the header is sticking to that wrapper instead.
//   Line 1 says "sticky", line 2 is the scroll container but DOES NOT SCROLL
//     -> the container has no bounded height; something further up scrolls.
(() => {
  const h = document.querySelector('thead');
  if (!h) return console.log('no <thead> found on this page');
  const s = getComputedStyle(h);
  console.log('1. thead position =', s.position, '| top =', s.top, '| class =', h.className);
  let e = h, first = true;
  while ((e = e.parentElement)) {
    const c = getComputedStyle(e);
    if (c.overflowX !== 'visible' || c.overflowY !== 'visible') {
      const scrolls = e.scrollHeight > e.clientHeight + 1;
      console.log(first ? '2. header sticks to:' : '   further up:', e.tagName, e.className, '| overflow', c.overflowX, c.overflowY, '|', scrolls ? 'SCROLLS' : 'DOES NOT SCROLL');
      first = false;
    }
  }
  if (first) console.log('2. no ancestor has overflow set: the header sticks to the page itself');
})();
