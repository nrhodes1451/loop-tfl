declare module "vt-pbf" {
  const vtpbf: {
    fromGeojsonVt: (
      layers: Record<
        string,
        {
          features: Array<{
            id?: number;
            type: number;
            geometry: number[][][];
            tags: Record<string, string | number | boolean>;
          }>;
        }
      >,
    ) => Uint8Array;
  };
  export default vtpbf;
}
