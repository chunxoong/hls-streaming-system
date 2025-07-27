require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

async function resetAdmin() {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        // Hash password
        const hashedPassword = await bcrypt.hash('admin123', 10);
        
        // Delete existing admin
        await connection.execute('DELETE FROM users WHERE username = ?', ['admin']);
        
        // Insert new admin
        await connection.execute(
            'INSERT INTO users (username, password, email) VALUES (?, ?, ?)',
            ['admin', hashedPassword, 'admin@hls4u.xyz']
        );
        
        console.log('✅ Admin user reset successfully');
        console.log('Username: admin');
        console.log('Password: admin123');
        
        await connection.end();
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

resetAdmin();
