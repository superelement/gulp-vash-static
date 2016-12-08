// through2 is a thin wrapper around node transform streams
var through = require('through2')
  , gutil = require("gulp-util")
  , watch = require('gulp-watch')
  , PluginError = gutil.PluginError
  , File = gutil.File
  , path = require('path')
  , replaceExt = require('replace-ext')
  , vashStatic = require('vash-static')
  , runSequence = require('run-sequence')
  , fs = require("fs")
  , _ = require("lodash")
	, slash = require("slash")
  , sav = require('log-saviour')

// Consts
const PLUGIN_NAME = 'gulp-vash-static';
const NS = "gulpVashStatic";

var argFunctionOverride; // Function to override the functionality of 'getAllArgs'. 

sav.setNameSpace(PLUGIN_NAME)

// Tells JSHint that these guys can be globals
/*global warn:true, warnArr:true, log:true, logArr:true*/
sav.setNameSpace(NS)
warn = sav.warn
warnArr = sav.warnArr
log = sav.log
logArr = sav.logArr

function prefixStream(prefixText) {
  var stream = through();
  stream.write(prefixText);
  return stream;
}


/**
 * Escapes common special characters in regexes
 * @param {string} str - String to escape
 * @returns {string} String made safe for regex.
 */
function regSlash(str) {
    if (str.indexOf("?") !== -1) str = str.split("?").join("\\?");
    if (str.indexOf("*") !== -1) str = str.split("*").join("\\*");

    return str;
}

/**
 * Gets the all argument from the command-line that starts with '--', omitting the '--' and finishing at the next space.
 * @param {string[]} [args] - Optionally pass in custom args, say from a child process when testing. 
 * @returns {string[]} Argument values without the '--' prefix.
 */
function getAllArgs(args) {
  
    // if 'argFunctionOverride' exists, use that instead
    if(argFunctionOverride) return argFunctionOverride(args);

		args = args || process.argv;

    var argVals = [];
    args.forEach(function (arg) {
        if (arg.indexOf("--") === 0) {
            var propArr = arg.split(" ");
            var argVal = propArr[0].substr(2);
            
            // allows shortcut for styleguide pages, starting with 'SG_'
            if(argVal && argVal.indexOf("SG_") === 0) argVal = "styleGuide/" + argVal;
            
            argVals.push( argVal );
        }
    });

    return argVals;
}


/**
 * Allows you to optionally override the functionality of 'getAllArgs', so you can manipulate arguments. First param should be the function and it should return a manipulated string containing the page name.
 * @param {Function} fun - Function to override 'getAllArgs'.
 */
function overrideGetAllArgs(fun) {
    if(typeof fun !== "function") {
      warn(NS, 'overrideGetAllArgs', "Arg 'fun' must be a function. Type was " + (typeof fun) );
      return;
    }
    argFunctionOverride = fun;
}



/**
 * Checks a file path exists and warns with error specific to vash pages if doesn't exist
 * @param {string} pageFilePath - File path to the vash template.
 * @returns {boolean} Success/fail
 */
function validatePageTemplate(pageFilePath) {

  if(!fs.existsSync(pageFilePath)) {
  	warn(NS, "validatePageTemplate", "Seems like that page doesn't have a Vash template.", pageFilePath)
    return false
  }

  return true
}


/**
 * Gets details relevant to Vash Static from a vinyl file
 * @param {Object} vinyl - Vinyl file.
 * @param {string[]} dirTypes - Array of 'directory types', such as 'pg', 'wg', 'glb'.
 * @returns {Object} Object literal with details
 */
function getVinylDetails(vinyl, dirTypes) {
	var type = vashStatic.getDirTypeFromPath(vinyl.path, dirTypes);
	return {
		type: type,
		moduleName: vashStatic.getModuleName(vinyl.path, type),
		fileName: vashStatic.getFileName( vinyl.path, true )
	}
}


/**
 * Precompiles a vash templates and generates a json file with the template's name and contents in it.
 * @param {object} opts - Options for the function:
    * @param {boolean} [opts.debugMode] - Production usage should pass false to keep file size down. Development should use true, for useful debugging info. Defaults to false. 
    * @param {string[]} [opts.dirTypes] - List of types. This type will be searched for in the filePath and is expected to be a full directory name. If not given, only page type will be used.
    * @param {string} [opts.modelsPath] - File path to the combined models js file, which can prepend your templates to provide model data. If not given, no models will be added.
		* @param {string} [cacheFileName] - Name of the json file output. Defaults to 'precompiled-vash.json'.
 */
function precompileTemplateCache(opts) {

	// sets default options
	opts = opts || {};
	opts.debugMode = opts.debugMode || false;
	opts.dirTypes = opts.dirTypes || false;
	opts.modelsPath = opts.modelsPath || null;
	opts.cacheFileName = opts.cacheFileName || "precompiled-vash.json";

	var tplcache = {}
	  , count = 0;

	var bufferContents = function(file, enc, cb) {
		if (file.isNull()) {
		  // return empty file
		  return cb(null, file);
		}

		// we don't do streams
	    if (file.isStream()) {
	      this.emit('error', new PluginError(PLUGIN_NAME,  'Streaming not supported'));
	      cb();
	      return;
	    }

	    opts.file = file.path;
	    vashStatic.precompileTemplateCache(opts, function(success, data) {
	    	if(!success) {
	    		this.emit('error', new PluginError(PLUGIN_NAME,  'Problem with "Vash Static".', data.msg));
	    	}
	    	else {
	    		tplcache[data.name] = data.contents;
	    		count++;
	    	}
	    	cb();
	    });
	};

	var endStream = function(cb) {
		
			var cwd = process.cwd();

				var file = new gutil.File({
				base: cwd,
				cwd: cwd,
				path: path.join(cwd, opts.cacheFileName)
			});


	    if (!count) {
	      this.emit('error', new PluginError(PLUGIN_NAME,  'No files were precompiled!'));
	      cb();
	      return;
	    }

			file.contents = new Buffer(JSON.stringify(tplcache))

	    this.push(file);
	    cb();
	}

	// Creating a stream through which each file will pass
	var stream = through.obj(bufferContents, endStream);

	return stream;
}

/**
 * Renders a 'page' vash template by name, which should be stored in the cacheDest, with optional helpers.
 * @param {object} opts - Options for the function:
		* @param {string} opts.cacheDest - Path to the JSON file containing the vash template cache.
		* @param {string} [opts.omitSubDir] - If given, will remove the first occurance of a sub-directory with this name when generating the template name.
		* @param {string[]} [helpers] - Array of paths to use as Vash helpers. Defaults will be used, unless overridden by name. Otherwise both lists will be used.
 */
function renderPage(opts) {

	// sets default options
	opts = opts || {};
	opts.cacheDest = opts.cacheDest || "./";

	// Creating a stream through which each file will pass
	var stream = through.obj(function(file, enc, cb) {
		if (file.isNull()) {
		  // return empty file
		  return cb(null, file);
		}

		if (file.isStream()) throw new PluginError(PLUGIN_NAME, 'Plugin does not support streams!');

		var pgTmplName = vashStatic.getModuleName(file.path, vashStatic.getPageDirType(), true)
		  , renderCnf = vashStatic.renderPage(opts.cacheDest, pgTmplName, opts.helpers)

		if(renderCnf.success) {
			file.contents = new Buffer(renderCnf.contents)
		} else {
			throw new PluginError(PLUGIN_NAME, renderCnf.contents.join(", ") );
		}

		// make sure we're changing the extention to an .html file, instead of .vash
		file.path = replaceExt(file.path, ".html")

		if(opts.omitSubDir) {
			opts.omitSubDir = opts.omitSubDir.split("/").join("");
			file.path = slash(file.path).replace("/" + opts.omitSubDir + "/", "/");
			//console.log("file.path", file.path)
		}

		// make sure the file goes through the next gulp plugin
		this.push(file);

		// tell the stream engine that we are done with this file
		cb();
	});

  return stream;
}


/**
 * Gets the correct schema for the 'template path', so it's always just got 1 source of truth.
 * @param {string} type - Type of module, such as 'pg', 'wg', 'glb'.
 * @param {string} moduleName - Name of the module (eg a page 'HomePage'' or a widget 'SiteFooter')
 * @param {string} [fileName] - File name of the template. Defaults to 'Index.vash' if not supplied.
 */
function getTemplatePathConfig(type, moduleName, fileName) {
  return {
          type: type
        , moduleName: moduleName
        , fileName: fileName || "Index.vash"
    }
}

/**
 * Convenience function for watching models and templates. All properties are mandatory.
 * @param {object} opts - Options for the function:
		* @param {object} opts.gulp - instance of gulp
		* @param {string} opts.vashSrc - vash templates to watch (accepts globbing)
		* @param {string} opts.modelSrc - models to watch (accepts globbing)
		* @param {string} opts.modelsDest - path to the models JS destination (once they are combined)
		* @param {string} opts.cacheDest - path to the template cache destination
		* @param {boolean} opts.debugMode - If this is for production, should be false
		* @param {string[]} opts.dirTypes - Module types (eg "pg", "wg", glb), which correspond to parent directory name of template modules.
		* @param {string} opts.pageTemplatePath - String for determining the path of the page-level template, where only the page name is known (eg "<%= type %>/<%= moduleName %>/tmpl/<%= fileName %>").
		* @param {string} opts.combineModelsTask - Gulp task name for combining your models
		* @param {string} opts.precompileTask - Gulp task name for pre-compiling your vash templates
		* @param {string} opts.pageRenderTask - Gulp task name for rendering a page
 */
function watchModelsAndTemplates(opts) {

	var runSeq = runSequence.use(opts.gulp)

  var preSeq = [];
  if(opts.combineModelsTask)  preSeq.push(opts.combineModelsTask);
  if(opts.precompileTask)     preSeq.push(opts.precompileTask);
  if(opts.pageRenderTask)     preSeq.push(opts.pageRenderTask);

	// just compiles everything once first before watching for changes
  if(preSeq.length) runSeq.apply(this, preSeq);
	
	// runs a watch task (using gulp-watch) that looks for changes to models and vash files

  var queue = []
    , isUpdating = false;

	return watch(opts.vashSrc.concat(opts.modelSrc), function(vinyl) {

	    var cacheAndRender = function(type, moduleName, contents, fileName) {
				
        // if currently updating the cache, put items in a queue for later
        if(isUpdating) {
          queue.push({ type:type, moduleName:moduleName, contents:contents, fileName:fileName });
          return
        }

        isUpdating = true;
	      vashStatic.updateCache({
	        type: type
	        , tmplPath: _.template(opts.pageTemplatePath)(getTemplatePathConfig(type, moduleName, fileName))
	        , contents: contents
	        , modelsPath: opts.modelsDest
	        , cacheDest: opts.cacheDest
	        , debugMode: opts.debugMode
	        , cb: function() {
            isUpdating = false;
            
            // goes throug queue until none left
            if(queue.length) {
              var firstItem = queue.shift();
              cacheAndRender(firstItem.type, firstItem.moduleName, firstItem.contents, firstItem.fileName);
            } else {

              // console.log("opts.pageRenderTask")
              runSeq(opts.pageRenderTask)
            }
	        }
	      })
	    }

	    // checks if changed file was a vash object or a model
	    if(vinyl.path.indexOf(".vash") !== -1) {
	      
	      // gets the details needed about the changed vash file from Vinyl object, then updates the template cache and page html
	      var cnf = getVinylDetails(vinyl, opts.dirTypes)

	      cacheAndRender(cnf.type, cnf.moduleName, vinyl.contents, cnf.fileName)

	    } else {

        var pgNames = getAllArgs();

	      // gets the page name from the expected command-line argument and cancels task if invalid
	      if(!pgNames.length) {
					warn(NS, "watchModelsAndTemplates", 'You need to pass page name in a flag like this "--home".')
					return false
				}

        var type = vashStatic.getPageDirType();

	      runSeq(opts.combineModelsTask, function() {
          pgNames.forEach(function(pgName) {

            // allows you to specify a fileName within the module
            var fileName = "Index.vash";
            if(pgName.indexOf("/") !== -1) {
              fileName = pgName.split("/")[1] + ".vash";
              pgName = pgName.split("/")[0];
            }

            var pageFilePath = _.template(opts.pageTemplatePath)(getTemplatePathConfig(type, pgName, fileName))
            if( !validatePageTemplate(pageFilePath) ) return

            // refreshes models.js by combining all models again, then updates the template cache and page html
            cacheAndRender(vashStatic.getPageDirType(), pgName, false, fileName);
          });
	      })
	    }
	})
}

// Exporting the plugin main function
module.exports = {
	suppressWarnings: sav.suppressWarnings
	, renderPage: renderPage
	, precompile: precompileTemplateCache
	, setPageDirType: vashStatic.setPageDirType
	, watchModelsAndTemplates: watchModelsAndTemplates
	, getAllArgs: getAllArgs
  , overrideGetAllArgs: overrideGetAllArgs
	, restoreGetAllArgs: function() {
		argFunctionOverride = null;
	}
	, testable: {
		regSlash: regSlash
		, validatePageTemplate: validatePageTemplate
		, getVinylDetails: getVinylDetails
	}
}