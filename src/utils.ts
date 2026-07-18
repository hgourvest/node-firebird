import messagesJson from './firebird.msg.json';
import Const from './wire/const';
import type { FbStatusItem } from './callback';

const MessagesError = messagesJson as Record<string, string>;

/**
 * Parse date from string
 */
export const parseDate = (str: string): Date => {
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
 */
/**
 * Turn a failed executeBatch completion into the all-or-nothing error
 * shape shared by database.executeBatch and batchStream: the first
 * record's own error (or a synthesized summary), with the full
 * completion attached as err.batchCompletion.
 */
export const batchResultToError = (result: { errors: { error: any }[]; errorRecordNumbers: number[] }): any => {
    const first = result.errors.length ? result.errors[0] : null;
    const err: any = first
        ? first.error
        : new Error('Batch failed for record(s) ' + result.errorRecordNumbers.join(', '));
    err.batchCompletion = result;
    return err;
};

export const lookupMessages = (status: FbStatusItem[]): string => {
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
 * @param value value to escape
 * @param protocolVersion optional, default: PROTOCOL_VERSION13
 */
export const escape = function(value: any, protocolVersion?: number): string {

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
        return "'" + value.getFullYear() + '-' + (value.getMonth()+1).toString().padStart(2, '0') + '-' + value.getDate().toString().padStart(2, '0') + ' ' + value.getHours().toString().padStart(2, '0') + ':' + value.getMinutes().toString().padStart(2, '0') + ':' + value.getSeconds().toString().padStart(2, '0') + '.' + value.getMilliseconds().toString().padStart(3, '0') + "'";

    throw new Error('Escape supports only primitive values.');
};

export function noop(): void {}
