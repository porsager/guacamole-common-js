export default [{
  input: 'src/index.js',
  output: [{
    file: 'dist/guacamole.cjs.js',
    format: 'cjs'
  }, {
    file: 'dist/guacamole.js',
    format: 'es'
  }]
}]
