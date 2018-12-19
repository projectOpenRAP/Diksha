let {
    addDikshaData
} = require('./diksha.middleware.js')
let {
    getHomePage,
    getEcarById,
    performSearch,
    telemetryData,
    extractFile,
    performRecommendation,
    createFolderIfNotExists
} = require('./diksha.controller.js');
// let { uploadTelemetryToCloud } = require('./diksha.telemetry_upload.js');

module.exports = app => {
    /*
        diksha API endpoints
    */
    app.post('/api/data/v1/page/assemble', getHomePage); // Needs fixing
    app.get('/api/content/v1/read/:contentID', getEcarById);
    app.post('/api/data/v1/telemetry', addDikshaData, telemetryData);
    app.post('/api/composite/v1/search', performSearch);
}
