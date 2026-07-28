//@ts-check

'use strict';

const path = require('path');
const webpack = require('webpack');

/** @typedef {import('webpack').Configuration} WebpackConfig **/

/**
 * 扩展宿主：跑在 Node 里，不能碰 DOM。
 *
 * 这里引入 @coderline/alphatab 只是为了用它的 alphaTex 解析器（做诊断和
 * 「地址 ↔ 源码位置」换算）。渲染、worker、字体、音色库全都发生在 webview 那边，
 * 所以不需要官方的 @coderline/alphatab-webpack 插件。
 * alphaTab 在检测到 webpack 时会警告缺少那个插件，`__ALPHATAB_WEBPACK__`
 * 定义成布尔值即可让它闭嘴——我们如实声明「没用那个插件」。
 */
/** @type WebpackConfig */
const extensionConfig = {
  target: 'node',
  mode: 'none',
  entry: './src/extension.ts',
  plugins: [
    new webpack.DefinePlugin({ __ALPHATAB_WEBPACK__: JSON.stringify(false) })
  ],
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2'
  },
  externals: {
    vscode: 'commonjs vscode'
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [{ loader: 'ts-loader' }]
      }
    ]
  },
  devtool: 'nosources-source-map',
  infrastructureLogging: { level: 'log' }
};

/**
 * webview 应用：跑在 webview 的浏览器上下文里。
 *
 * 这里**不打包 @coderline/alphatab**——它由 webview/alphaTab.min.js 以普通
 * <script> 引入（UMD 会挂到 globalThis.alphaTab）。理由有两个：
 *   1. 不用把同一个 1.1 MB 的库装两份
 *   2. 合成器 worker 需要拿到这个包的**原始文本**去做同源 blob，
 *      所以它无论如何都得作为独立文件存在
 * webview 代码里只用 `import type` 引类型，编译后会被完全抹掉。
 */
/** @type WebpackConfig */
const webviewConfig = {
  target: 'web',
  mode: 'none',
  entry: './webview/src/main.ts',
  output: {
    path: path.resolve(__dirname, 'webview', 'dist'),
    filename: 'app.js'
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [{
          loader: 'ts-loader',
          options: { configFile: path.resolve(__dirname, 'webview', 'tsconfig.json') }
        }]
      }
    ]
  },
  devtool: 'nosources-source-map',
  infrastructureLogging: { level: 'log' }
};

module.exports = [extensionConfig, webviewConfig];
