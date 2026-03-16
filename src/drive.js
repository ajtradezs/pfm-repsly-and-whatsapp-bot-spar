/**
 * drive.js
 * Uploads images to imgbb (free image hosting) and returns a public URL
 * for use in =IMAGE() formulas in Google Sheets.
 *
 * Get a free API key at https://api.imgbb.com
 */

const https = require('https');
const querystring = require('querystring');

/**
 * Uploads a base64 image to imgbb and returns the direct image URL.
 * Returns null if upload fails so logging continues without the image.
 */
async function uploadImage(base64data, mimeType, filename) {
    const apiKey = process.env.IMGBB_API_KEY;
    if (!apiKey) {
        console.error('  ⚠️  IMGBB_API_KEY not set — skipping photo upload');
        return null;
    }

    return new Promise((resolve) => {
        const postData = querystring.stringify({
            key: apiKey,
            image: base64data,
            name: filename
        });

        const options = {
            hostname: 'api.imgbb.com',
            path: '/1/upload',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    if (json.success && json.data && json.data.url) {
                        resolve(json.data.url);
                    } else {
                        console.error('  ⚠️  imgbb upload failed:', json.error?.message || 'unknown error');
                        resolve(null);
                    }
                } catch (err) {
                    console.error('  ⚠️  imgbb response parse error:', err.message);
                    resolve(null);
                }
            });
        });

        req.on('error', (err) => {
            console.error('  ⚠️  imgbb request error:', err.message);
            resolve(null);
        });

        req.write(postData);
        req.end();
    });
}

module.exports = { uploadImage };
