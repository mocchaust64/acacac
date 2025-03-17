const webpack = require('webpack');

module.exports = {
  webpack: {
    configure: {
      resolve: {
        fallback: {
          crypto: require.resolve('crypto-browserify'),
          stream: require.resolve('stream-browserify'),
          http: require.resolve('stream-http'),
          https: require.resolve('https-browserify'),
          zlib: require.resolve('browserify-zlib'),
          url: require.resolve('url/'),
          buffer: require.resolve('buffer/'),
          process: require.resolve('process/browser'),
        },
      },
      plugins: [
        new webpack.ProvidePlugin({
          Buffer: ['buffer', 'Buffer'],
          process: 'process/browser',
        }),
      ],
    },
  },
  devServer: {
    host: '0.0.0.0',
    allowedHosts: 'all',
  }
};