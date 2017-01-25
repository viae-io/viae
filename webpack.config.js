let webpack = require('webpack');
module.exports = {
  entry: './src/index.ts',
  output: {
    filename: 'viae.js',
    path: './lib',
  },
  module: {
    rules: [
      {
        test: /\.ts?$/,
        loader: 'awesome-typescript-loader'
      }
    ]
  },
  externals: [ "rowan", "stream"],
  resolve: {
    extensions: [".ts", ".js"]
  },
  plugins: [
    new webpack.optimize.UglifyJsPlugin({
      compress: {
        warnings: false
      }
    })
  ]
}