require('dotenv').config();
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

async function quickTest() {
    const connection = await mysql.createConnection({
        host: 'localhost',
        user: 'hls4u-stream', 
        password: 'N72kySNBgREd9nNCnu3m',
        database: 'hls4u-stream'
    });
    
    // Create fresh admin with known hash
    const hash = await bcrypt.hash('admin123', 10);
    
    await connection.execute('DELETE FROM users WHERE username = ?', ['admin']);
    await connection.execute(
        'INSERT INTO users (username, password, email) VALUES (?, ?, ?)',
        ['admin', hash, 'admin@test.com']
    );
    
    // Test the hash
    const test = await bcrypt.compare('admin123', hash);
    console.log('Hash test:', test ? 'PASS' : 'FAIL');
    
    await connection.end();
    console.log('Admin reset complete');
}

quickTest().catch(console.error);
