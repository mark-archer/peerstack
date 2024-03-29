// var CompressionPlugin = require('compression-webpack-plugin');

module.exports = {
  entry: './src/index.ts',

  mode: 'development',

  output: {
    path: __dirname + '/dist',
    filename: 'index.bundle.dev.js',
    library: 'peerstack',
    libraryTarget: 'umd'
  },
  resolve: {
    // Add '.ts' and '.tsx' as resolvable extensions.
    extensions: [".ts", ".tsx", ".js", ".json"]
  },

  module: {
    rules: [
      // All files with a '.ts' or '.tsx' extension will be handled by 'ts-loader'.
      { test: /\.tsx?$/, loader: "ts-loader" },
    ]
  },

  plugins: [
    // new CompressionPlugin() // gzips the bundle
  ],

  // When importing a module whose path matches one of the following, just
  // assume a corresponding global variable exists and use that instead.
  // This is important because it allows us to avoid bundling all of our
  // dependencies, which allows browsers to cache those libraries between builds.
  externals: {
    "react": "React",
    "react-dom": "ReactDOM",
    "fs": "fs",
    "react-native-fs": "react-native-fs",
    "realm": "realm",
    "web-push": "web-push"
  }
};