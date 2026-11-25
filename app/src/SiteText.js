'use strict';
const shared = require('../../public/js/SiteText');
let purifier;
function forValue(value) {
    // Plain configuration inspection must not start a DOM runtime in every inspector child.
    if (!/[<&]/.test(String(value ?? ''))) return undefined;
    if (!purifier) purifier = require('dompurify')(new (require('jsdom').JSDOM)('').window);
    return purifier;
}
module.exports = {
    html: (value, key) => shared.html(value, key, forValue(value)),
    plain: value => shared.plain(value, forValue(value)),
    fields: shared.fields,
};
