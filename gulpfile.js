'use strict';

var gulp = require('gulp');
var gutil = require('gutil');
var ts = require('gulp-typescript');
var jasmine = require('gulp-jasmine');
var plumber = require('gulp-plumber');
var sourcemap = require('gulp-sourcemaps');
var rimraf = require('gulp-rimraf');
var replace = require('gulp-replace');
var tslint = require('gulp-tslint');
var formatter = require('typescript-formatter');
var typescript = require('typescript');

var path = require('path');
var merge = require('merge2');
var sequence = require('run-sequence');
var through = require('through2');

var paths = {
  source: "src/",
  output: "lib/",
  spec: "spec/"
}
var title = "viae";

/**
 * Cleaning
 */

gulp.task('clean:source', function () {
  return gulp.src([paths.output], { read: false })
    .pipe(rimraf());
});

gulp.task('clean:spec', function () {
  return gulp.src([paths.spec + '**/*.spec.js', paths.spec + '**/*.map'], { read: false })
    .pipe(rimraf());
});

gulp.task('clean', ['clean:spec', 'clean:source'], function () {
});

/**
 * Formatting
 */

function gulpTypescriptFormatter(options) {
  return through.obj(function (file, enc, cb) {
    if (file.isNull()) {
      // return empty file
      return cb(null, file);
    }

    if (file.isBuffer()) {
      var fileContentPromise = formatter.processString(file.path, String(file.contents), options);

      fileContentPromise.then(function (result) {
        file.contents = new Buffer(result.dest);

        cb(null, file);
      });
    }
  });
}

function format(sourcePattern, targetDir) {
  return gulp.src(sourcePattern)
    .pipe(gulpTypescriptFormatter({
      baseDir: '.',
      tslint: true, // use tslint.json file ?
      editorconfig: true, // use .editorconfig file ?
      tsfmt: true, // use tsfmt.json ?
    }))
    .pipe(gulp.dest(targetDir));
}


gulp.task('format:source', function () {
  return format(paths.source + '**/*.ts', paths.source);
});

gulp.task('format:spec', function () {
  return format(paths.spec + '**/*.ts', paths.spec);
});

gulp.task('format', ['format:source', 'format:spec'], function () { });

/**
 * Linting
 */


gulp.task('lint:source', function () {
  return gulp.src([paths.source + '**/*.ts', paths.spec + '**/*.ts'])
    .pipe(plumber())
    .pipe(tslint({
      formatter: "verbose"
    }))
    .pipe(tslint.report());
});


const webpack = require('webpack');


/**
 * Compiling
 */

gulp.task('compile', ["clean"], function (done) {
  sequence("compile:source", "compile:typings", "compile:spec", done);
});

gulp.task('compile:source', function (callback) {
  webpack({
    entry: {
      index: './src/index'
    },
    output: {
      path: path.join(__dirname, 'lib'),
      filename: 'index.js',
      library: title,
      libraryTarget: 'umd'
    },
    resolve: {
      modules: [path.join(__dirname, 'node_modules')],
      extensions: ['.js', '.jsx', '.ts', 'tsx'],
    },
    module: {
      loaders: [
        {
          test: /\.ts$/i,
          loaders: ['awesome-typescript-loader'],
        },
      ]
    },
    plugins: [
      new webpack.optimize.UglifyJsPlugin({ minimize: true, output: { comments: false }, sourceMap: true }),
      new webpack.SourceMapDevToolPlugin({
        test: /\.js$/,
        moduleFilenameTemplate: '[absolute-resource-path]',
        fallbackModuleFilenameTemplate: '[absolute-resource-path]?[hash]',
        filename: "[file].map",
        sourceRoot: '../src'
      })
    ],
    externals: [{
      "rowan": true,
      "readable-stream": true,
      "varint": true,
      "tslib": true,
    }]
  }, function (err, stats) {
    if (err) throw new gutil.PluginError("webpack", err);
    gutil.log("[webpack]", stats.toString({
      // output options
    }));
    callback();
  });
});


gulp.task('compile:typings', function () {
  var tsProject = ts.createProject('tsconfig.json', {
    typescript: require('typescript')
  });

  var tsResult = gulp.src([paths.source + '**/*.ts'])
    .pipe(sourcemap.init())
    .pipe(tsProject());

  return tsResult.dts.pipe(gulp.dest(paths.output))
});

gulp.task('compile:spec', function () {
  var tsProject = ts.createProject('tsconfig.json', {
    typescript: typescript
  });

  var tsResult = gulp.src([paths.spec + '**/*.spec.ts'])
    .pipe(sourcemap.init())
    .pipe(tsProject());

  return tsResult.js
    .pipe(sourcemap.write('.', { sourceRoot: '.' }))
    .pipe(replace(/(source\/)/g, '/lib\/'))
    .pipe(gulp.dest('spec/'));
});

/**
 * Testing
 */

gulp.task('test:jasmine', function (done) {
  return gulp.src('spec/*.js')
    .pipe(plumber())
    .pipe(jasmine({ verbose: true }));
});

gulp.task('test', function (done) {
  sequence('compile:source', 'compile:spec', 'lint:source', 'test:jasmine', function (err) {
    sequence('clean:spec');
    done();
  });
});

gulp.task('test:nocompile', function (done) {
  sequence('test:jasmine', function (err) {
    sequence('clean:spec');
    done();
  });
});

/**
 * Main Tasks
 */

gulp.task('build', ['test'], function () {
});

gulp.task('watch', ['test'], function () {
  gulp.watch(paths.source + '**/*.ts', ['build']);
  gulp.watch(paths.spec + '**/*spec.ts', ['build']);
});

gulp.task('default', ['test'], function () {
});