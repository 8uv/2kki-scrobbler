// const yieldForGlobal = (name: string,  timeout: number = 125): Promise<any> => {
//     return new Promise(async (resolve, reject) => {
//         try {
//             const g = eval(name);
//             if (typeof g !== 'undefined') resolve(g)
//                 else await new Promise(r => setTimeout(r, timeout)).then(() => resolve(yieldForGlobal(name, timeout)));
//         } catch (e) {
//             reject(e);
//         }
//     });
// };

const yieldForGlobal = (name: string,  timeout: number = 125): Promise<any> => {
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

const yieldForProp = async (obj: any, prop: string, timeout: number = 125): Promise<any> => {
    return new Promise((resolve) => {
        const interval = setInterval(() => {
            if (obj[prop] !== undefined) {
                clearInterval(interval);
                resolve(obj[prop]);
            }
        }, timeout);
    });
};

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export { yieldForGlobal, yieldForProp, alphabet };