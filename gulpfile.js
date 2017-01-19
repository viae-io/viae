'use strict';

var gulp = require('gulp');
var ts = require('gulp-typescript');
var jasmine = require('gulp-jasmine');
var plumber = require('gulp-plumber');
var sourcemap = require('gulp-sourcemaps');
var rimraf = require('gulp-rimraf');
var replace = require('gulp-replace');
var tslint = require('gulp-tslint');
var formatter = require('typescript-formatter');

var path = require('path');
var merge = require('merge2');
var runsequence = require('run-sequence');
var through = require('through2');

var paths = {
  source: "source/",
  output: "lib/",
  spec: "spec/"
}

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


/**
 * Compiling
 */


gulp.task('compile:source', ['clean:source'], function () {
  var tsProject = ts.createProject('tsconfig.json', {
    typescript: require('typescript')
  });

  var tsResult = gulp.src([paths.source + '**/*.ts'])
    .pipe(sourcemap.init())
    .pipe(tsProject());

  return merge([
    tsResult.dts.pipe(gulp.dest(paths.output)),
    tsResult.js
      .pipe(sourcemap.write('.', {
        sourceRoot: function (file) {
          var relative = path.relative(file.path, path.join(__dirname, "source"));
          var relativeSource = path.join(relative, 'source')
          return relativeSource;
        }
      }))
      .pipe(gulp.dest(paths.output))
  ]);
});

gulp.task('compile:spec', ['compile:source', 'clean:spec'], function () {
  var tsProject = ts.createProject('tsconfig.json', {
    typescript: require('typescript')
  });

  var tsResult = gulp.src([paths.spec + '**/*spec.ts'])
    .pipe(sourcemap.init())
    .pipe(tsProject());

  return tsResult.js
    .pipe(sourcemap.write('.', {
      sourceRoot: function (file) {
        var relative = path.relative(file.path, path.join(__dirname, "spec"));
        var relativeSource = path.join(relative, 'spec')
        return relativeSource;
      }
    }))
    .pipe(replace(/(source\/)/g, 'lib/'))
    .pipe(gulp.dest(paths.spec));
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
  runsequence('compile:spec', 'lint:source', 'test:jasmine', function (err) {
    runsequence('clean:spec');
    done();
  });
});

gulp.task('test:nocompile', function (done) {
  runsequence('test:jasmine', function (err) {
    runsequence('clean:spec');
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