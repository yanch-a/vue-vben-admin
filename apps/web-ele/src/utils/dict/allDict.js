const dictMap = {};

const modulesFiles = import.meta.glob('./dictConfig/*.js', { eager: true });

Object.keys(modulesFiles).forEach((path) => {
  const value = modulesFiles[path];
  if (value) {
    const key = path.substring(path.lastIndexOf('/') + 1, path.lastIndexOf('.'));
    dictMap[key] = value.default;
  }
});

export default dictMap;
