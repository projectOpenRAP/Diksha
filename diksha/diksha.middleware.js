let {
    initializeDikshaData
} = require('./diksha.init.js')

let dikshaData = {};

let addDikshaData = (req, res, next) => {
    req.dikshaData = dikshaData;
    next();
}

initalizeMiddleWare = () => {
    initializeDikshaData('/opt/opencdn/appServer/plugins/diksha/profile.json').then(value => {
        dikshaData = value;
    });
}

initalizeMiddleWare();

module.exports = {
    addDikshaData
}
