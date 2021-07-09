"use strict";

const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);

const config = require("../services/config.js");
const MySQLConnector = require("../services/mysql.js");

const { scanner, manualdb } = config.db;
const dbSelection = manualdb.useFor.includes("session") ? manualdb : scanner;
const db = new MySQLConnector(dbSelection);

// MySQL session store
const sessionStore = new MySQLStore({
    // Database server IP address/hostname
    host: dbSelection.host,
    // Database server listening port
    port: dbSelection.port,
    // Database username
    user: dbSelection.username,
    // Password for the above database user
    password: dbSelection.password,
    // Database name to save sessions table to
    database: dbSelection.database,
    // Whether or not to automatically check for and clear expired sessions:
    clearExpired: true,
    // How frequently expired sessions will be cleared; milliseconds:
    checkExpirationInterval: 900000,
    // Whether or not to create the sessions database table, if one does not already exist
    createDatabaseTable: true,
    // Set Sessions table name
    schema: {
        tableName: dbSelection.sessionTable
    }
});

const isValidSession = async (userId, currentSessionId) => {
    let sql = `
    SELECT session_id, flagged
    FROM ${dbSelection.sessionTable}
    WHERE
        json_extract(data, '$.user_id') = ?
        AND expires >= UNIX_TIMESTAMP()
    `;
    let args = [userId];
    let results = await db.query(sql, args);
    for ( let s = 0; s < results.length; s++) {
        if (results[s].session_id == currentSessionId) {
            if (results[s].flagged === 0 && results.length > config.maxSessions) {
                clearOtherSessions(userId, currentSessionId);
            }
            if (results[s].flagged > 0) {
                return {
                    valid: false,
                    description: "Flagged Session Identified and Terminated"
                };
            } else {
                if (results.length > 0) {
                    return { 
                        valid: true 
                    };
                } else {
                    return { 
                        valid: false, 
                        description: "Invalid Session ID" 
                    };
                }
            }
        }
    }
};

const clearOtherSessions = async (userId, currentSessionId) => {
    let sql = `
    UPDATE ${dbSelection.sessionTable}
    SET flagged = 1, expires = UNIX_TIMESTAMP() + 65
    WHERE
        json_extract(data, '$.user_id') = ?
        AND session_id != ?
    `;
    let args = [userId, currentSessionId];
    db.query(sql, args);
};

module.exports = {
    sessionStore,
    isValidSession,
    clearOtherSessions
};
