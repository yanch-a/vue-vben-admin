/** 异步工作区加载的代次门禁，后发意图优先；同 ID 再点也可废弃旧请求。 @author yanch */
export function createEtlRequestGate() {
  let generation = 0;
  return {
    begin: () => ++generation,
    stamp: () => generation,
    current: (request: number) => request === generation,
    invalidate: () => {
      generation++;
    },
  };
}
