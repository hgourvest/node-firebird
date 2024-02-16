const MessagesError = require('./firebird.msg.json');
const Const = require('./wire/const');

/**
 * Parse date from string
 * @param {String} str
 * @return {Date}
 */
const parseDate = (str) => {
    const self = str.trim();
    const arr = self.indexOf(' ') === -1 ? self.split('T') : self.split(' ');
    let index = arr[0].indexOf(':');
    const length = arr[0].length;

    if (index !== -1) {
        const tmp = arr[1];
        arr[1] = arr[0];
        arr[0] = tmp;
    }

    if (arr[0] === undefined) {
        arr[0] = '';
    }

    const noTime = arr[1] === undefined || arr[1].length === 0;

    for (let i = 0; i < length; i++) {
        const c = arr[0].charCodeAt(i);
        if (c > 47 && c < 58) {
            continue;
        }
        if (c === 45 || c === 46) {
            continue;
        }
        if (noTime) {
            return new Date(self);
        }
    }

    if (arr[1] === undefined) {
        arr[1] = '00:00:00';
    }

    const firstDay = arr[0].indexOf('-') === -1;

    const date = (arr[0] || '').split(firstDay ? '.' : '-');
    const time = (arr[1] || '').split(':');

    if (date.length < 4 && time.length < 2) {
        return new Date(self);
    }

    index = (time[2] || '').indexOf('.');

    // milliseconds
    if (index !== -1) {
        time[3] = time[2].substring(index + 1);
        time[2] = time[2].substring(0, index);
    } else {
        time[3] = '0';
    }

    const parsed = [
        parseInt(date[firstDay ? 2 : 0], 10), // year
        parseInt(date[1], 10), // month
        parseInt(date[firstDay ? 0 : 2], 10), // day
        parseInt(time[0], 10), // hours
        parseInt(time[1], 10), // minutes
        parseInt(time[2], 10), // seconds
        parseInt(time[3], 10) // miliseconds
    ];

    const def = new Date();

    for (let i = 0; i < parsed.length; i++) {
        if (isNaN(parsed[i])) {
            parsed[i] = 0;
        }

        const value = parsed[i];
        if (value !== 0) {
            continue;
        }

        switch (i) {
            case 0:
                if (value <= 0) {
                    parsed[i] = def.getFullYear();
                }
                break;
            case 1:
                if (value <= 0) {
                    parsed[i] = def.getMonth() + 1;
                }
                break;
            case 2:
                if (value <= 0) {
                    parsed[i] = def.getDate();
                }
                break;
        }
    }

    return new Date(parsed[0], parsed[1] - 1, parsed[2], parsed[3], parsed[4], parsed[5]);
}

/**
 * Get Error Message per gdscode
 * @param {{gdscode: Number, params: Any[]}[]} status
 * @returns {String} - Error message
 */
const lookupMessages = (status) => {
    const messages = status.map((item) => {
        let text = MessagesError[item.gdscode];
        if (text === undefined) {
            return 'Unknow error';
        }
        if (item.params !== undefined) {
            item.params.forEach((param, i) => {
                text = text.replace('@' + (i + 1), param);
            });
        }
        return text;
    });
    return messages.join(', ');
}

/**
 * Escape value
 * @param {Object} value
 * @param {Number} protocolVersion (optional, default: PROTOCOL_VERSION13)
 * @return {String}
 */
const escape = function(value, protocolVersion) {

    if (value === null || value === undefined)
        return 'NULL';

    switch (typeof(value)) {
        case 'boolean':
            if ((protocolVersion || Const.PROTOCOL_VERSION13) >= Const.PROTOCOL_VERSION13)
                return value ? 'true' : 'false';
            else
                return value ? '1' : '0';
        case 'number':
            return value.toString();
        case 'string':
            return "'" + value.replace(/'/g, "''").replace(/\\/g, '\\\\') + "'";
    }

    if (value instanceof Date)
        return "'" + value.getFullYear() + '-' + (value.getMonth()+1).toString().padLeft(2, '0') + '-' + value.getDate().toString().padLeft(2, '0') + ' ' + value.getHours().toString().padLeft(2, '0') + ':' + value.getMinutes().toString().padLeft(2, '0') + ':' + value.getSeconds().toString().padLeft(2, '0') + '.' + value.getMilliseconds().toString().padLeft(3, '0') + "'";

    throw new Error('Escape supports only primitive values.');
};

function noop() {}

module.exports = {
    escape,
    lookupMessages,
    noop,
    parseDate,
};
