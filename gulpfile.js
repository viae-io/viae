var gulp = require('gulp');
var gulpts = require('gulp-typescript');
var typescript = require('typescript');

gulp.task('typings', () => {
  var project = gulpts.createProject('tsconfig.json', {
    typescript: typescript
  });
  return gulp.src(['src/**/*.ts']).pipe(project()).dts.pipe(gulp.dest('./lib'));
});