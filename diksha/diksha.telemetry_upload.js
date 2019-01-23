let jwt = require('jsonwebtoken');
let winston = require('winston');
let {
    exec
} = require('child_process');
let q = require('q');
let request = require('request');
let fs = require('fs');
let dns = require('dns');
let cron = require('node-cron');
// let registerURL = 'https://api.ekstep.in/api-manager/v1/consumer/cdn_device/credential/register';
let telemetryURL = 'https://diksha.gov.in/api/data/v1/telemetry';
let appJwt = '';
let zlib = require('zlib');

let JWT_ALGORITHM = 'HS256';
let logFile = '/tmp/telemetry_upload.log';
let deviceKey = deviceSecret = tmJwt = "";

let logOptimizationLimit = 25;
let logCurrentValue = 0;

let { generateOriginalJWTs } = require('./diksha.helper.js')

//TODO: Replace below code with reading of JSON file
let telemetryDir = "/home/admin/diksha/telemetry/"
let telemetryTimerInterval = 300;
let telemetryTokenGenerateTimerInterval = 300;
let currentTokenStatus = 0 //Invalid Token

let logger = logfd = null;

let randomAlphabet = () => {
    return (String.fromCharCode(parseInt(Math.random() * 94) + 33));
}

let random = (x) => {
    let s = '';
    for (let i = 0; i < x; i++) {
        s += randomAlphabet();
    }
    return s;
}



let loggingInit = () => {
    let defer = q.defer();
    logger = new(winston.Logger)({
        transports: [
            new(winston.transports.Console)(),
            new(winston.transports.File)({
                name: 'info',
                filename: logFile,
                level: 'info'
            }),
            new(winston.transports.File)({
                name: 'debug',
                filename: logFile,
                level: 'debug'
            }),
            new(winston.transports.File)({
                name: 'error',
                filename: logFile,
                leevel: 'error'
            })
        ]
    });
    logger.log('info', "START: LogFile " + logFile);
    defer.resolve();
    return defer.promise;
}


let runCommand = (command) => {
    let defer = q.defer();
    exec(command, (err, stdout, stderr) => {
        if (err) {
            return defer.reject({
                err
            });
        } else {
            return defer.resolve({
                stdout,
                stderr
            });
        }
    });
    return defer.promise;
}

let generateJwt = (key, secret) => {
    let defer = q.defer();
    let payload = {
        "iss": key
    };
    let options = {
        algorithm: 'RS256'
    }
    jwt.sign(payload, secret, (err, token) => {
        if (err) {
            return defer.reject({
                err
            });
        } else {
            return defer.resolve({
                token
            });
        }
    });
    return defer.promise;
}

let checkConnectivity = () => {
    let defer = q.defer();
    //TODO: Import the connectivity checking code from telemetry SDK
    dns.resolve('www.google.com', (err) => {
        if (err) {
            dns.resolve('aws.amazon.com', (err) => {
                if (err) {
                    defer.reject({
                        err
                    });
                } else {
                    defer.resolve();
                }
            });
        } else {
            defer.resolve();
        }
    });
    return defer.promise;
}

let requestTokenGeneration = () => {
    let defer = q.defer();
    console.log("Fetching telemetry keys.");

    generateOriginalJWTs().then(value => {
        console.log("We have obtained " + value.token);
        tmJwt = value.token;
        currentTokenStatus = 1;
        return uploadTelemetryDirectory();
    }).then(value => {
        defer.resolve();
    }).catch(e => {
        console.log("Error: " + e.err);
        defer.reject();
    });

    return defer.promise;
}

let generateToken = () => {
    logger.log('info', "Generating token...");

    let defer = q.defer();
    if (currentTokenStatus != 0) {
        //Token already exists
        console.log("Token exists!");
    }
    let deviceKey = random(16);
    console.log("Generated random " + deviceKey);
    let statusCode = 0;
    requestTokenGeneration().then(value => {
        return defer.resolve();
    }).catch(e => {
        return defer.reject(e);
    });
    return defer.promise;
}

let uploadTelemetryFile = (fileName, jwt, endpoint = telemetryURL) => {
    let defer = q.defer();
    //Construct a POST request
    let authText = "bearer " + jwt;
    let headers = {
        'Content-Type': 'application/json',
    //    'Content-Encoding': 'gzip',
    //    'Accept-Encoding': 'gzip',
        'Authorization': authText
    };
    console.log("Let's upload")
    fs.readFile(fileName, (err, data) => {
        if (err) {
            return defer.reject(err);
        } else {
            let options = {
                url: endpoint,
                method: 'POST',
                headers,
                body: JSON.parse(data.toString()),
                json: true
            }
            console.log("Options are:", options)
            request(options, (err, res, body2) => {
                console.log("Upload attempt over")
                console.log(body2)
                let body = null;
                if (err) {
                    return defer.reject({
                        err
                    });
                }
                if (typeof body2 === 'undefined') {
                    return defer.reject({
                        err: res
                    })
                }
                // Here lies my soul
                if (typeof body2.params !== 'undefined') {
                    body = body2;
                } else {
                    body = JSON.stringify(body2);
                    console.log(body)
                    body.params = {};
                }
                let responseCode = body.responseCode;
                let params = body.params;
                return defer.resolve({
                    responseCode,
                    params
                });
            });
        }
    });
    return defer.promise;
}

let getTime = (file) => {
    let defer = q.defer();
    fs.stat(file, (err, stats) => {
        if (err) {
            return defer.reject();
        } else {
            return defer.resolve(stats);
        }
    });
    return defer.promise;
}

let getListOfTimes = (dir, files) => {
    let fileTuples = [];
    let fileTuplePromises = [];
    let defer = q.defer();
    for (let i = 0; i < files.length; i++) {
        fileTuplePromises.push(getTime(dir + files[i]));
    }
    q.allSettled(fileTuplePromises).then(values => {
        for (let i = 0; i < values.length; i++) {
            if (values[i].state == "fulfilled") {
                fileTuples.push([dir + files[i], values[i].value.mtimeMs]);
            }
        }
        return defer.resolve(fileTuples);
    }).catch(e => {
        console.log(e);
        return defer.reject(e);
    });
    return defer.promise;
}

let sortFilesByDate = (dir, files) => {
    let defer = q.defer();
    getListOfTimes(dir, files).then(value => {
        let fileTuples = value;
        fileTuples.sort((a, b) => {
            return a[1] - b[1];
        });
        let returnable = [];
        for (let i = 0; i < fileTuples.length; i++) {
            returnable.push(fileTuples[i][0]);
        }
        return defer.resolve(returnable);
    });
    return defer.promise;

}

let uploadTelemetryFileWrapper = (file) => {
    let defer = q.defer();
    console.log("Gonna upload", file)
    uploadTelemetryFile(file, tmJwt, telemetryURL).then(value => {
        console.log("Uploading returned ", value);
        if (value.responseCode === 'SUCCESS' || value.err === 'INVALID_DATA_ERROR') {
            logger.log("info", "Telemetry upload(" + file + ") status : " + value.status + ' err: ' + value.errMsg);
            fs.unlink(file, (err) => {
                if (err) {
                    logger.log("info", "Couldn't delete telemetry " + file + " after upload");
                } else {
                    logger.log("info", "Successfully deleted telemety " + file + " after upload");
                }
            });
        } else if (value.statusCode == 401) {
            logger.log("info", "Telemetry upload(" + fileName + ") status : " + value.status + ' err: ' + value.errMsg);
            logger.log("info", "Unauthorized: Regenerating Token...");
            generateToken();
            return defer.resolve();
        } else if (value.statusCode == 429) {
            logger.log("info", "Telemetry upload(" + fileName + ") status : " + value.status + ' err: ' + value.errMsg);
            logger.log("info", "Ratelimit: API rate limit exceeded...");
            return defer.reject("313");
        } else {
            console.log("Whatever comes below")
            console.log(value);
            return defer.reject("316");
        }
    }).catch(reason => {
        console.log("Some failure due to ", reason);
        return defer.reject({err: reason});
    });
    return defer.promise;
}

let uploadTelemetryDirectory = () => {
    //Check if telemetry directory exists, else just return
    let defer = q.defer();
    let telDir = telemetryDir;
    fs.readdir(telDir, (err, files) => {
        if (err) {
            logger.log("error", "Directory read error: " + err);
            return defer.reject();
        } else if (files.length < 1) {
            logger.log("error", "No files to upload")
            return defer.reject();
        } else {
            checkConnectivity().then(value => {
                logger.log("info", "Internet connected!");
                let rateLimit = 1000;
                console.log("Sorting time");
                sortFilesByDate(telDir, files).then(value => {
                    console.log("number of files:", value.length)
                    sortedFileList = value;
                    telemetryUploadPromises = [];
                    for (let i = 0; i < sortedFileList.length; i++) {
                        file = sortedFileList[i];
                        console.log("Uploading time")
                        telemetryUploadPromises.push(uploadTelemetryFileWrapper(file));
                    }
                    q.allSettled(telemetryUploadPromises).then(values => {
                        for (let i = 0; i < values.length; i++) {
                            if (values[i].state !== 'fulfilled') {
                                console.log(values[i]);
                                console.log("OMG FAIL")
                                return defer.reject();
                            }
                        }
                        console.log("OMG PASS")
                        return defer.resolve();
                    });
                }).catch(err => {
                    logger.log("error", err);
                    return defer.reject({
                        err
                    });
                });
            });
        }
    });
    return defer.promise;
}


let startUploadngTelemetry = () => {
    console.log("diksha telemetry shall now be uploaded.");
    cron.schedule("*/1 * * * *", () => {
        loggingInit().then(value => {
            return generateToken();
        }).then(value => {
            console.log("Success");
        }).catch(e => {
            console.log("Error");
            console.log(e);
            console.log("Finished with errors");
        });
    });
}

module.exports = {
    startUploadngTelemetry
}
