(() => {
  // Read the actual page background, including its own light/dark toggle. Only a
  // numeric color leaves the page; there is no JavaScript-to-native command bridge.
  let element = document.elementFromPoint(innerWidth / 2, Math.max(0, innerHeight - 2)) || document.body;
  while (element) {
    const match = getComputedStyle(element).backgroundColor.match(/^rgba?\(([^)]+)\)$/);
    if (match) {
      const values = match[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      if (values.length === 3 || values[3] >= 0.99) {
        const rgb = values.slice(0, 3).map(value => Math.min(255, Math.max(0, Math.round(value))));
        return (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
      }
    }
    element = element.parentElement;
  }
  return null;
})();
