declare const GM_info: {
    script: {
        name: string;
        version: string;
    }
};

export const yieldForGlobal = (name: string,  timeout: number = 125): Promise<any> => {
    return new Promise(async (resolve, reject) => {
        try {
            const g = eval(`typeof ${name} !== 'undefined' ? ${name} : undefined`);
            if (g) resolve(eval(name))
                else await new Promise(r => setTimeout(r, timeout)).then(() => resolve(yieldForGlobal(name, timeout)));
        } catch (e) {
            reject(e);
        }
    });
};

export const yieldForProp = async (obj: any, prop: string, timeout: number = 125): Promise<any> => {
    return new Promise((resolve) => {
        const interval = setInterval(() => {
            if (obj[prop] !== undefined) {
                clearInterval(interval);
                resolve(obj[prop]);
            }
        }, timeout);
    });
};

export const Log = (...args: any[]) => {
    console.log(`%c[${GM_info.script.name} v${GM_info.script.version}]`, 'font-size: 1.4em; color: #de99d1; text-shadow: 1px 1px 0px #fff;', ...args);
}