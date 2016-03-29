const uglify = require('uglify-js')
    , fs = require('fs')

fs.writeFileSync('./guacamole.min.js', uglify.minify('./guacamole.js').code)
