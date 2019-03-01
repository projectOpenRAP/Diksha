let multiparty = require('connect-multiparty');
let multipartMiddle = multiparty();
let fs = require('fs');
let q = require('q');
let {
    createFolderIfNotExists,
    extractFile
} = require('./diksha.controller.js');
let {
    readdir,
    deleteDir
} = require('../../../filesdk');
let {
    exec
} = require('child_process');
let {
    initializeSbDB
} = require('./diksha.db_restart.js');
let {
    addDocument
} = require('../../../searchsdk/index.js');
let {
    startUploadngTelemetry
} = require('./diksha.telemetry_upload.js');



let initializeDikshaData = (path) => {
    let defer = q.defer();
    fs.readFile(path, (err, data) => {
        if (err) {
            return defer.reject(err);
        } else {
            try {
                let config = JSON.parse(data);
                let currentProfile = config.active_profile;
                let currentConfig = config.available_profiles[currentProfile];
                //diksha = currentConfig;
                return defer.resolve(currentConfig);
            } catch (e) {
                console.log(e);
                return defer.reject(false);
            }
        }
    });
    return defer.promise;
}

/*
    Reads ecar files from the location defined in profile.json and extracts them
*/

let processEcarFiles = (filePath) => {
    return readdir(filePath)
        .then(files => {
            return files
                .filter(file => file.endsWith('.ecar'))
                .reduce((chainedExtractPromises, file) => {
                    return chainedExtractPromises.then(
                        () => {
                            console.log(`Extraction of ${file} completed.`);

                            return extractFile(filePath, file);
                        },
                        err => {
                            console.log(`Extraction of ${file} failed.`);
                            console.log(err);

                            return extractFile(filePath, file);
                        });
                }, q.when());
        });
}

/*
    Adds the JSON files to BleveSearch Database
*/

let jsonDocsToDb = (dir) => {
    let defer = q.defer();
    /*
        Updated behavior: Carpet bomb the index and rebuild from scratch
    */
    initializeSbDB().then(value => {
        console.log("Index successfully recreated");
        let promises = [];
        fs.readdir(dir, (err, files) => {
            if (err) {
                return defer.reject(err);
            } else {
                for (let i = 0; i < files.length; i++) {
                    if (files[i].lastIndexOf('.json') + '.json'.length === files[i].length) {
                        promises.push(addDocument({
                            indexName: "dk.db",
                            documentPath: dir + files[i]
                        }))
                    }
                }
                q.allSettled(promises).then(values => {
                    values.forEach(value => {
                        if (typeof value.value.err !== 'undefined') {
                            console.log("Error encountered!")
                            return defer.reject(value.value.err);
                        }
                    });
                    return defer.resolve(values[0].value.success);
                });
            }
        });
    }).catch(e => {
        defer.reject(e);
    });
    return defer.promise;
}

let initialize = () => {

    /*
    initialize telemetry upload
    */
    startUploadngTelemetry();
    /*
        read all ecars and add to search index
    */
    let dikshaData = {};
    initializeDikshaData('/opt/opencdn/appServer/plugins/diksha/profile.json').then(value => {
        dikshaData = value;
        return createFolderIfNotExists(dikshaData.media_root);
    }).then(value => {
        console.log("Created " + dikshaData.media_root);
        return createFolderIfNotExists(dikshaData.telemetry);
    }).then(value => {
        console.log("Created " + dikshaData.telemetry);
        return createFolderIfNotExists(dikshaData.json_dir);
    }).then(value => {
        console.log("Created " + dikshaData.json_dir);
        return createFolderIfNotExists(dikshaData.content_root);
    }).then(value => {
        console.log("Created " + dikshaData.content_root);
        return createFolderIfNotExists(dikshaData.unzip_content);
    }).then(value => {
        console.log("Created " + dikshaData.unzip_content);
        return processEcarFiles(dikshaData.media_root);
    }).then(value => {
        return jsonDocsToDb(dikshaData.json_dir);
    }, reason => {
        console.log(reason);
        console.log("There seem to be corrupt ecar files in the directory.");
        return jsonDocsToDb(dikshaData.json_dir);
    }).then(value => {
        console.log("Initialized API Server");
    }).catch(e => {
        console.log(e);
        if (typeof e.state === 'undefined') {
            console.log(e);
            console.log("Could not initialize API Server");
        }
    });

}
/*
    Initializes plugin metadata
*/
initialize();

/*
    Initializes telemetry upload
*/

module.exports = {
    initializeDikshaData
}
