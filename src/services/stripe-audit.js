/* eslint-disable no-async-promise-executor */
const moment = require('moment');
const ontime = require('ontime');
const config = require('../configs/stripe.json');
const guilds = require('../configs/discords.json').discords;

const MySQLConnector = require('./mysql.js');
const db = new MySQLConnector(config.stripe.db);

const DiscordClient = require('./discord.js');
const StripeClient = require('./stripe.js');

const stripe = require('stripe')(config.stripe.live_sk);
//const stripe = require('stripe')('sk_test_51BFqArHIrnCEspBZIahCA8TcdZKHOGD3YUd1qWbMGcoyLkvPo09sf2kNT9irUWlnGO6QiHgqSmqJ7d5OOTAsa2A400OldQIPgt');

function identifyGuild(data) {
    return new Promise((resolve) => {
        for (let d = 0, dlen = guilds.length; d < dlen; d++) {
            if (guilds[d].name !== 'test') {
                if (data.plan_id) {
                    if (guilds[d].recurring_id === data.plan_id) {
                        return resolve(guilds[d]);
                    }
                    if (guilds[d].onetime_id === data.plan_id) {
                        return resolve(guilds[d]);
                    }
                    if (guilds[d].alt_plan_id === data.plan_id) {
                        return resolve(guilds[d]);
                    }
                } else if (data.guild_id) {
                    if (guilds[d].id === data.guild_id) {
                        return resolve(guilds[d]);
                    }
                } else if (data.guild_name) {
                    if (data.guild_name.includes(guilds[d].name)) {
                        return resolve(guilds[d]);
                    }
                } else {
                    console.error('Bad data received.', data);
                    return resolve(false);
                }
            }
        }
    });
}

function stripeAudit(last) {
    return new Promise((resolve) => {
        stripe.customers.list({
            limit: 100,
            starting_after: last
        },
        async function (err, list) {
            if (err) {
                console.log(err.message);
                return resolve();
            } else {
                const more = list.has_more;
                console.log(`[MapJS] [${getTime()}] [services/stripe.js] Processing a Batch of ${list.data.length} Customers... More: ${list.has_more}`);
                await customersAudit(list.data);
                if (more) {
                    await stripeAudit(list.data[list.data.length - 1].id);
                    return resolve();
                } else {
                    setTimeout(() => {
                        console.log(`[MapJS] [${getTime()}] [services/stripe.js] Stripe Customer Audit Complete.`);
                        return resolve();
                    }, 1000 * (list.data.length + 1));
                }
            }
        });
    });
}


function customersAudit(customers) {
    return new Promise((resolve) => {
        const length = customers.length;
        for (let c = 0, clen = length; c < clen; c++) {
            const stripeCustomer = customers[c];
            setTimeout(async () => {
                const name = stripeCustomer.name ? stripeCustomer.name : stripeCustomer.description;
                if (!name) {
                    console.error('No Name for Customer', stripeCustomer);
                }
                const customer = new StripeClient({
                    user_id: (name.split(' - ')[1]),
                    user_name: (name.split(' - ')[0]),
                    customer_id: stripeCustomer.id,
                    subscription_id: (stripeCustomer.subscriptions.data[0] ? stripeCustomer.subscriptions.data[0].id : null),
                    plan_id: (stripeCustomer.subscriptions.data[0] ? stripeCustomer.subscriptions.data[0].plan.id : null)
                });
                const record = await customer.fetchRecordByCustomer();
                if (record) {
                    const user = new DiscordClient(record);
                    if (stripeCustomer.subscriptions.data[0] || !Number.isInteger(parseInt(record.subscription_id))) {
                        const guild = await customer.identifyGuild();
                        if (guild.id !== record.guild_id) {
                            user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', `Incorrect Guild ID found for ${customer.customerId} 🔎`, '');
                        }
                        user.setGuildInfo(guild);
                        switch(true) {
                            case record.user_id !== customer.userId:
                                console.log(`[MapJS] [${getTime()}] [services/stripe.js] Customer user_id (${stripeCustomer.name}) does not match the db user_id ${(record.user_name + ' - ' + record.user_id)}.`);
                                console.log('0 ID Check', (record.user_id !== customer.userId), record.user_id, customer.userId);
                                customer.updateCustomerName(); break;
                            case !record.plan_id:
                            case !record.subscription_id:
                            case record.plan_id !== customer.planId:
                            case record.subscription_id !== customer.subscriptionId:
                                customer.updateDbRecord(); break;
                            case (stripeCustomer.name != (record.user_name + ' - ' + record.user_id)):
                                console.log('1 Name Check', (stripeCustomer.name != (record.user_name + ' - ' + record.user_id)), stripeCustomer.name, record.user_name + ' - ' + record.user_id);
                                customer.updateCustomerName(null, record.user_name + ' - ' + record.user_id); break;
                        }
                        const validSubscription = await customer.validateSubscription();
                        if (validSubscription) {
                            if (validSubscription.status == 'past_due') {
                                user.removed = await user.removeDonorRole();
                                if (user.removed) {
                                    console.log(`[MapJS] [${getTime()}] [services/stripe.js] ${customer.userName} (${record.user_id}) found with a Past Due Subscription. Removed Donor Role.`);
                                    user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Customer found with a Past Due Subscription 🔎', '');
                                    user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Donor Role Removed ⚖', '');
                                }
                            } else {
                                user.assigned = await user.assignRole(guild.donorRole);
                                if (user.assigned) {
                                    console.log(`[MapJS] [${getTime()}] [services/stripe.js] ${customer.userName} (${record.user_id}) found without a Donor Role and assigned Role.`);
                                    user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Customer found without a Donor Role 🔎', '');
                                    user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'Donor Role Assigned ⚖', '');
                                }
                            }
                        } else {
                            // customer.clearDbRecord();
                            // customer.deleted = customer.deleteCustomer();
                            if (customer.deleted) {
                                user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Customer with Invalid Subscription Deleted', '');
                            }
                            console.log(`[MapJS] [${getTime()}] [services/stripe.js] ${customer.userName} (${customer.userId}) has an invalid Subscription.`);
                            user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Invalid Subscription Found 🔎', `Customer: ${customer.customerId}`);
                            user.removed = await user.removeDonorRole();
                            if (user.removed) {
                                user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Donor Role Removed ⚖', '');
                            }
                        }
                    } else {
                        const last_charge = await customer.retrieveLastCharge();
                        if (last_charge.data[0]) {
                            const guild = await identifyGuild({ guild_name: last_charge.data[0].description});
                            user.setGuildInfo(guild);
                            customer.guildId = guild.id;
                            customer.guildName = guild.name;
                            customer.planId = guild.onetime_id;
                            switch(true) {
                                case record.user_id !== customer.userId:
                                    console.log(`[MapJS] [${getTime()}] [services/stripe.js] Customer user_id (${stripeCustomer.name}) does not match the db user_id ${(customer.userName + ' - ' + record.user_id)}.`);
                                    customer.clearDbRecord(); break;
                                case !record.subscription_id:
                                    console.log(`[MapJS] [${getTime()}] [services/stripe.js] Found Missing Subscription ID for ${customer.userName} (${record.user_id}).`);
                                    customer.subscriptionId = moment.unix(parseInt(last_charge.data[0].created)).add(1, 'M').unix();
                                    customer.updateDbRecord(); break;
                                case !record.plan_id:
                                case record.plan_id !== customer.planId:
                                    console.log(`[MapJS] [${getTime()}] [services/stripe.js] Found Plan ID Discrepency for ${customer.userName} (${record.user_id}).`);
                                    customer.updateDbRecord(); break;
                                case (stripeCustomer.name != (record.user_name + ' - ' + record.user_id)):
                                    console.log('2 Name Check', (stripeCustomer.name != (record.user_name + ' - ' + record.user_id)), stripeCustomer.name, record.user_name + ' - ' + record.user_id);
                                    customer.updateCustomerName(); break;
                            }
                            const expiration = parseInt(record.subscription_id);
                            if (expiration < moment().unix()) {
                                console.log(`[MapJS] [${getTime()}] [services/stripe.js] One Month Access Expired for ${customer.userName} (${customer.userId}).`);
                                user.sendDmEmbed('FF0000', 'Your One Month Access has Expired!', `Please visit ${guild.domain}/subscribe to renew or change to a subscription.`);
                                user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'One Month Access Expired ⌛', '');
                                customer.clearDbRecord();
                                customer.deleted = customer.deleteCustomer();
                                if (customer.deleted) {
                                    user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Expired Customer Deleted', '');
                                }
                                user.removed = await user.removeDonorRole();
                                if (user.removed) {
                                    user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Donor Role Removed ⚖', '');
                                }
                            } else {
                                if (moment().unix() >= (expiration - 97200) && moment().unix() < (expiration - 75600)) {
                                    user.sendDmEmbed('FF0000', 'Hello! Your One Month Access is expiring in ~24 hours!', `Please visit ${guild.domain}/account if you wish to renew! **If you would like to switch to a subscription**, wait until your expiration notice and then go to ${guild.domain}/subscribe.`);
                                }
                                user.assigned = await user.assignRole(guild.donorRole);
                                if (user.assigned) {
                                    console.log(`[MapJS] [${getTime()}] [services/stripe.js] ${customer.userName} (${record.user_id}) found without a Donor Role and assigned Role.`);
                                    user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Customer found without a Donor Role 🔎', '');
                                    user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'Donor Role Assigned ⚖', '');
                                }
                            }
                        } else {
                            console.error(`[MapJS] [${getTime()}] [services/stripe.js] Found a customer with no charge history.`, stripeCustomer);
                            const guild = await customer.identifyGuild({ guild_id: record.guild_id });
                            console.log(`[MapJS] [${getTime()}] [services/stripe.js] Invalid Customer found for ${customer.userName} (${record.user_id}) .`);
                            // customer.clearDbRecord();
                            // customer.deleted = customer.deleteCustomer();
                            if (customer.deleted) {
                                user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Expired Customer Deleted', '');
                            }
                            user.removed = await user.removeDonorRole();
                            if (user.removed) {
                                user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Donor Role Removed ⚖', '');
                            }
                        }
                    }
                } else {
                    console.error(`[MapJS] [${getTime()}] [services/stripe.js] No Customer Record Found.`, stripeCustomer);
                    if (stripeCustomer.subscriptions.data[0]) {
                        await customer.identifyGuild();
                        customer.insertCustomerRecord();
                    } else {
                        const last_charge = await customer.retrieveLastCharge();
                        if (last_charge.data[0]) {
                            const guild = await identifyGuild({ guild_name: last_charge.data[0].description});
                            customer.guildId = guild.id;
                            customer.guildName = guild.name;
                            customer.planId = guild.onetime_id;
                            customer.subscriptionId = moment.unix(parseInt(last_charge.data[0].created)).add(1, 'M').unix();
                            customer.insertCustomerRecord();
                        } else {
                            console.error(`[MapJS] [${getTime()}] [services/stripe.js] Found a customer with no charge history.`, stripeCustomer);
                            customer.deleteCustomer();
                        }
                    }
                }
                if ((c + 1) == length) {
                    return resolve();
                }
            }, 1000 * c);
        }
        setTimeout(() => {
            return resolve();
        }, 1000 * (length + 1));
    });
}


function databaseAudit() {
    return new Promise(async (resolve) => {
        console.info(`[MapJS] [${getTime()}] [services/stripe.js] Starting Database Audit... (2 of 3)`);
        const records = await db.query(`SELECT * FROM ${config.stripe.db.customer_table} WHERE customer_id is NOT NULL;`);
        for (let r = 0, rlen = records.length; r < rlen; r++) {
            const record = records[r];
            setTimeout(async () => {
                const guild = await identifyGuild({
                    guild_id: record.guild_id
                });
                if (guild) {
                    const user = new DiscordClient(record);
                    user.setGuildInfo(guild);
                    const member = await user.checkIfMember(record.guild_id);
                    const customer = new StripeClient(record);
                    if (member) {
                        if (record.customer_id == 'Lifetime') {
                            user.assigned = await user.assignRole(guild.donorRole);
                            if (user.assigned) {
                                console.log(`[MapJS] [${getTime()}] [services/stripe.js] ${record.user_name} (${record.user_id}) found without a Donor Role and assigned Role.`);
                                user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Lifetime Member found without a Donor Role 🔎', '');
                                user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'Donor Role Assigned ⚖', '');
                            }
                        } else {
                            const validCustomer = await customer.validateCustomer();
                            if (validCustomer) {
                                if (Number.isInteger(parseInt(record.subscription_id))) {
                                    const expiration = parseInt(record.subscription_id);
                                    if (expiration < moment().unix()) {
                                        console.error('EXPIRED ONETIME');
                                        customer.clearDbRecord();
                                        customer.deleted = customer.deleteCustomer();
                                        if (customer.deleted) {
                                            user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Expired Customer Deleted', '');
                                        }
                                        user.removed = await user.removeDonorRole();
                                        if (user.removed) {
                                            user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'One Month Access Expired ⌛', '');
                                            user.sendDmEmbed('FF0000', 'Hello! Your One Month Access has Expired!', `Please visit ${guild.domain} to renew!`);
                                            user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Donor Role Removed ⚖', '');
                                        }
                                    } else {
                                        user.assigned = await user.assignRole(guild.donorRole);
                                        if (user.assigned) {
                                            console.log(`[MapJS] [${getTime()}] [services/stripe.js] ${customer.userName} (${record.user_id}) found without a Donor Role and assigned Role.`);
                                            user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Customer found without a Donor Role 🔎', '');
                                            user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'Donor Role Assigned ⚖', '');
                                        }
                                    }
                                } else {
                                    const validSubscription = await customer.validateSubscription();
                                    if (validSubscription) {
                                        if (validSubscription.status == 'past_due') {
                                            user.removed = await user.removeDonorRole();
                                            if (user.removed) {
                                                console.log(`[MapJS] [${getTime()}] [services/stripe.js] ${customer.userName} (${record.user_id}) found with a Past Due Subscription. Removed Donor Role.`);
                                                user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Customer found with a Past Due Subscription 🔎', '');
                                                user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Donor Role Removed ⚖', '');
                                            }
                                        } else {
                                            if (!record.guild_name || record.guild_name == 'null' || record.guild_name !== guild.name) {
                                                console.info(`[MapJS] [${getTime()}] [services/stripe.js] Found discrepency. Updating guild_name for ${customer.userName} (${record.user_id}).`);
                                                db.query(`UPDATE ${config.stripe.db.customer_table} SET guild_name = '${guild.name}' WHERE user_id = '${record.user_id}' AND guild_id = '${guild.id}'`);
                                            }
                                            if (!record.subscription_id || record.subscription_id == 'null') {
                                                console.info(`[MapJS] [${getTime()}] [services/stripe.js] Found discrepency. Updating subscription_id for ${customer.userName} (${record.user_id}).`);
                                                db.query(`UPDATE ${config.stripe.db.customer_table} SET subscription_id = '${customer.subscriptionId}' WHERE user_id = '${record.user_id}' AND guild_id = '${guild.id}'`);
                                            }
                                            if (!record.guild_name || record.guild_name !== guild.name) {
                                                console.info(`[MapJS] [${getTime()}] [services/stripe.js] Found discrepency. Updating guild_name for ${customer.userName} (${record.user_id}).`);
                                                db.query(`UPDATE ${config.stripe.db.customer_table} SET guild_name = '${guild.name}' WHERE user_id = '${record.user_id}' AND guild_id = '${guild.id}'`);
                                            }
                                            user.assigned = await user.assignRole(guild.donorRole);
                                            if (user.assigned) {
                                                console.log(`[MapJS] [${getTime()}] [services/stripe.js] ${customer.userName} (${record.user_id}) found without a Donor Role and assigned Role.`);
                                                user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Customer found without a Donor Role 🔎', '');
                                                user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'Donor Role Assigned ⚖', '');
                                            }
                                        }
                                    } else {
                                        console.error(`[MapJS] [${getTime()}] [services/stripe.js] ${customer.userName} (${customer.userId}) has an invalid Subscription.`, customer);
                                        // customer.clearDbRecord();
                                        // customer.deleted = customer.deleteCustomer();
                                        if (customer.deleted) {
                                            user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Customer without a Subscription Deleted', '');
                                        }
                                        user.removed = await user.removeDonorRole();
                                        if (user.removed) {
                                            user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Donor Role Removed ⚖', '');
                                        }
                                    }
                                }
                            } else {
                                console.log(`[MapJS] [${getTime()}] [services/stripe.js] Invalid Customer Found: ${customer.customerId} (${customer.userName} - ${customer.userId})`);
                                user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Invalid Customer Found 🔎', `Customer: ${customer.customerId}`);
                                customer.clearDbRecord();
                                user.removed = await user.removeDonorRole();
                                if (user.removed) {
                                    console.log(`[MapJS] [${getTime()}] [services/stripe.js] Removed Donor Role from ${customer.userName} (${customer.userId}).`);
                                    user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Donor Role Removed ⚖', '');
                                }
                            }                                                                          
                        }
                    } else {
                        const validCustomer = await customer.validateCustomer();
                        if (!validCustomer) {
                            console.error(`[MapJS] [${getTime()}] [services/stripe.js] Invalid Customer Record found in the Database for ${record.user_name} (${record.user_id}).`);
                            customer.clearDbRecord();
                        }
                    }
                } else {
                    console.error(`[MapJS] [${getTime()}] [services/stripe.js] No Guild Identified for Record.`, record);
                }
                if ((r + 1) === records.length) {
                    console.info(`[MapJS] [${getTime()}] [services/stripe.js] Database Audit Complete.`);
                    return resolve();
                }
            }, 1000 * (r + 1));
        }
    });
}


function guildsAudit(guild_id) {
    return new Promise(async (resolve) => {
        if (!guild_id) {
            console.info(`[MapJS] [${getTime()}] [services/stripe.js] Starting Guild Audit. (3 of 3)`);
        }
        for (let d = 0, dlen = guilds.length; d < dlen; d++) {
            const guildToCheck = guilds[d];
            if (guildToCheck.role && guildToCheck.name != 'test') {
                const guild = new DiscordClient({
                    guild_id: guildToCheck.id,
                    guild_name: guildToCheck.name,
                    donor_role: guildToCheck.role
                });
                const members = await guild.fetchGuildDonors();
                await membersAudit(guildToCheck, members);
            }
            if ((d + 1) === guilds.length) {
                console.info(`[MapJS] [${getTime()}] [services/stripe.js] Guild Audit Complete.`);
                return resolve();
            }
        }
    });
}


function membersAudit(guild, members) {
    return new Promise((resolve) => {
        for (let m = 0, mlen = members.length; m < mlen; m++) {
            setTimeout(async () => {
                const customer = new StripeClient({
                    user_id: members[m].id,
                    user_name: members[m].user.username,
                    guild_id: guild.id,
                    guild_name: guild.name,
                    donor_role: guild.donorRole
                });
                const user = new DiscordClient({
                    user_id: members[m].id,
                    user_name: members[m].user.username,
                    guild_id: guild.id,
                    guild_name: guild.name,
                    donor_role: guild.donorRole
                });
                const record = await customer.fetchRecordByUser();
                if (record) {
                    if (record.plan_id !== 'Lifetime') {
                        record.donor_role = guild.donorRole;
                        customer.setClientInfo(record);
                        user.setClientInfo(record);
                        const userRoles = await user.getUserRoles();
                        if (config.ignored_roles && !config.ignored_roles.some(r => userRoles.includes(r))) {
                            if (record.customer_id) {
                                if (record.plan_id === guild.recurring_id || record.plan_id === guild.onetime_id || record.plan_id === guild.alt_plan_id) {
                                    const valid = await customer.validateCustomer();
                                    if (valid) {
                                        user.assigned = await user.assignRole(guild.donorRole);
                                        if (user.assigned) {
                                            console.log(`[MapJS] [${getTime()}] [services/stripe.js] ${user.userName} (${user.userId}) found without a Donor Role.`);
                                            user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Customer found without a Donor Role 🔎', '');
                                            user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'Donor Role Assigned ⚖', '');
                                        }
                                    } else {
                                        console.log(`[MapJS] [${getTime()}] [services/stripe.js] Found Invalid Customer, ${record.user_name} (${record.customer_id})`);
                                        user.removed = await user.removeDonorRole();
                                        if (user.removed) {
                                            user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Donor Role Removed ⚖', '');
                                        }
                                    }
                                } else {
                                    console.log(`[MapJS] [${getTime()}] [services/stripe.js] User's plan (${record.plan_id}) does not match any discord plans. Clearing customer data for ${record.user_name} in the db record.`);
                                    user.removed = await user.removeDonorRole();
                                    if (user.removed) {
                                        user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Donor Role Removed ⚖', '');
                                    }
                                }
                            } else {
                                console.error(`[MapJS] [${getTime()}] [services/stripe.js] No Customer ID in the Database, ${record.user_name} (${record.user_id})`, record);
                                user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Member found without a Customer ID 🔎', '');
                                user.removed = await user.removeDonorRole();
                                if (user.removed) {
                                    user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Donor Role Removed ⚖', '');
                                }
                            }
                        }
                    }
                } else {
                    console.log(`[MapJS] [${getTime()}] [services/stripe.js] Record not found for ${customer.userName} (${customer.userId}).`);
                    user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'DB Record Not Found for user with Donor Role 🔎', '');
                    user.removed = await user.removeDonorRole();
                    if (user.removed) {
                        user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Donor Role Removed ⚖', '');
                    }
                }
                if ((m + 1) === members.length) {
                    return resolve();
                }
            }, 1000 * m);
        }
        setTimeout(() => {
            return resolve();
        }, 1000 * (members.length + 1));
    });
}

    
ontime({
    cycle: ['00:00']
},
async function (ot) {
    console.info(`[MapJS] [${getTime()}] [services/stripe.js] Starting Audits...`);
    console.info(`[MapJS] [${getTime()}] [services/stripe.js] Starting Stripe Audit... (1 of 3)`);
    await stripeAudit();
    await databaseAudit();
    await guildsAudit();
    console.info(`[MapJS] [${getTime()}] [services/stripe.js] Audits Complete.`);
    return ot.done();
});

// setTimeout(async () => {
//     console.info(`[MapJS] [${getTime()}] [services/stripe.js] Starting Audits...`);
//     console.info(`[MapJS] [${getTime()}] [services/stripe.js] Starting Stripe Audit... (1 of 3)`);
//     await stripeAudit();
//     await databaseAudit();
//     await guildsAudit();
//     console.info(`[MapJS] [${getTime()}] [services/stripe.js] Audits Complete.`);
// }, 5000);

function getTime(type) {
    switch (type) {
        case 'full':
            return moment().format('dddd, MMMM Do  h:mmA');
        default:
            return moment().format('hh:mmA');
    }
}