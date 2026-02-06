declare module "asciichart" {
  type PlotConfig = {
    height?: number;
    min?: number;
    max?: number;
    offset?: number;
    padding?: string;
    format?: (x: number) => string;
  };

  function plot(series: number[] | number[][], config?: PlotConfig): string;

  export default { plot };
  export { plot };
}
