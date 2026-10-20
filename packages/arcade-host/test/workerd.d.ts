// workerd 包没带类型：默认导出是按平台装好的二进制的路径
declare module 'workerd' {
  const path: string;
  export default path;
}
