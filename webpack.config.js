let webpack = require('webpack');
let path = require('path');

module.exports = {
  entry: './src/index.ts',
  output: {
    filename: 'index.js',
    path: './lib',
    library: 'Viae',
    libraryTarget: 'umd'    
  },
  module: {
    rules: [
      {
        test: /\.ts?$/,     
        exclude: [
          path.resolve(__dirname, "test")
        ],
        loader: 'awesome-typescript-loader'
      }
    ]
  },
  externals: ["varint", "stream", "rowan", "tslib"],
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