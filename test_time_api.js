const axios = require('axios');

async function testTimeApi() {
    console.log('Testing timeapi.io for Venezuela...');
    try {
        const response = await axios.get('https://timeapi.io/api/Time/current/zone?timeZone=America/Caracas');
        console.log('Success:', response.data);
    } catch (error) {
        console.error('Error:', error.message);
    }
}

testTimeApi();
