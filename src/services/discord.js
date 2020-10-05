/* eslint-disable no-async-promise-executor */
/* global BigInt */
'use strict';

const moment = require('moment');

const config = require('../services/config.js');
const discords = require('../configs/discords.json').discords;

const DiscordOauth2 = require('discord-oauth2');
const oauth = new DiscordOauth2();

const Discord = require('discord.js');
const client = new Discord.Client();

if (config.discord.enabled) {
    client.on('ready', async () => {
        console.log(`[MapJS] [${getTime()}] [services/stripe.js] Logged in as ${client.user.tag}!`);
        client.user.setPresence({ activity: { name: config.discord.status, type: 3 } });
    });

    client.login(config.discord.botToken);
}

class DiscordClient {

    constructor(user) {
        this.accessToken = user.access_token;
        this.userId = user.user_id;
        this.userName = user.user_name;
        this.guildId = user.guild_id;
        this.guildName = user.guild_name;
        this.donorRole = user.donor_role;
        this.mapUrl = user.map_url;
        this.email = user.email;
        return;
    }

    setClientInfo(userInfo) {
        this.userId = userInfo.user_id;
        this.userName = userInfo.user_name;
        this.guildId = userInfo.guild_id;
        this.guildName = userInfo.guild_name;
        this.donorRole = userInfo.donor_role;
        this.mapUrl = userInfo.map_url;
        this.email = userInfo.email;
        return;
    }

    setGuildInfo(GuildInfo){
        this.guildId = GuildInfo.id;
        this.guildName = GuildInfo.name;
        this.donorRole = GuildInfo.role;
        this.mapUrl = GuildInfo.domain;
        return;
    }

    async getUser() {
        return await oauth.getUser(this.accessToken);
    }

    async getGuilds() {
        try{
            const guilds = await oauth.getUserGuilds(this.accessToken);
            
            const guildIds = Array.from(guilds, x => BigInt(x.id).toString());
            return guildIds;
        } catch (e){
            return false;
        }
        
    }

    async getUserRoles(guild_id) {
        try {
            if(!guild_id){
                guild_id = this.guildId;
            }
            const members = await client.guilds.cache
                .get(this.guildId)
                .members
                .fetch();
            const member = members.get(this.userId);
            const roles = member.roles.cache
                .filter(x => BigInt(x.id).toString())
                .keyArray();
            return roles;
        } catch (e) {
            console.error('Failed to get roles in guild', this.guildId, 'for user', this.userId);
            console.error(e);
        }
        return [];
    }

    async getPerms() {
        const perms = {
            map: false,
            pokemon: false,
            raids: false,
            gyms: false,
            pokestops: false,
            quests: false,
            lures: false,
            invasions: false,
            spawnpoints: false,
            iv: false,
            pvp: false,
            s2cells: false,
            submissionCells: false,
            nests: false,
            scanAreas: false,
            weather: false,
            devices: false
        };
        const guilds = await this.getGuilds();
        if(!guilds){
            return false;
        }
        if (config.open_map === true || config.discord.allowedUsers.includes(this.userId)) {
            Object.keys(perms).forEach((key) => perms[key] = true);
            return perms;
        }

        let blocked = false;
        for (let i = 0; i < config.discord.blockedGuilds.length; i++) {
            const guildId = config.discord.blockedGuilds[i];
            // Check if user's guilds contains blocked guild
            if (guilds.includes(guildId)) {
                // If so, user is not granted access
                blocked = true;
                break;
            }
        }

        if (blocked) {
            // User is in blocked guild
            return perms;
        }

        for (let i = 0; i < config.discord.allowedGuilds.length; i++) {
            // Check if user is in config guilds
            const guildId = config.discord.allowedGuilds[i];
            if (!guilds.includes(guildId)) {
                continue;
            }
            const keys = Object.keys(config.discord.perms);
            // Loop through each permission section
            for (let j = 0; j < keys.length; j++) {
                const key = keys[j];
                let configItem = config.discord.perms[key];
                if (configItem.enabled && configItem.roles.length === 0) {
                    // If type enabled and no roles specified, set as valid
                    perms[key] = true;
                    continue;
                }
                
                // If set, grab user roles for guild
                const userRoles = await this.getUserRoles(guildId);
                // Check if user has config role assigned
                for (let k = 0; k < userRoles.length; k++) {
                    // Check if assigned role to user is in config roles
                    if (configItem.roles.includes(userRoles[k])) {
                        perms[key] = true;
                    }
                }
            }
        }
        return perms;
    }


    // validateUser() {
    //     return new Promise(async (resolve) => {

    //     });
    // }


    joinGuild() {
        client.users.fetch(this.userId).then((user) => {
            let options = {
                'accessToken': this.accessToken
            };
            client.guilds.cache.get(this.guildId).addMember(user, options);
            console.error(`[MapJS] [${getTime()}] [services/discord.js] ${this.userName} (${this.userId}) joined to ${this.guildName}.`);
            return true;
        });
    }


    async guildMemberCheck() {
        const members = await this.fetchGuildMembers(this.guildId);
        if (members) {
            const member = members.get(this.userId);
            if (member){
                return true;
            } else {
                console.error(`[MapJS] [${getTime()}] [services/discord.js] ${this.userName} (${this.userId}) is not a Member of ${this.guildName}.`);
                //this.joinGuild();
                return false;
            }
        } else {
            console.error(`[MapJS] [${getTime()}] [services/discord.js] No members found for ${this.guildName} (${this.guildId}).`);
            return true;
        }
    }


    fetchGuildMembers(guild_id) {
        return new Promise(async (resolve) => {
            const members = await client.guilds.cache
                .get(guild_id)
                .members
                .fetch();
            if(members){
                return resolve(members);
            } else {
                console.error(`[MapJS] [${getTime()}] [services/discord.js] unable to fetch members for ${guild_id}.`);
                return resolve(false);
            }
        });
    }


    fetchGuildDonors() {
        return new Promise(async (resolve) => {
            const guild = await client.guilds.cache
                .get(this.guildId);
            const members = guild.roles.cache
                .find(role => role.id === this.donorRole)
                .members
                .map(m => m);
            return resolve(members);
        });
    }


    fetchAllMembersArray() {
        return new Promise(async (resolve) => {
            const allMembers = [];
            for(let d = 0, dlen = discords.length; d < dlen; d++){
                let members = await this.fetchGuildMembers(discords[d].id);
                members = members.map(m => m);
                for(let m = 0, mlen = members.length; m < mlen; m++){
                    allMembers.push(members[m]);
                }
            }
            return resolve(allMembers);
        });
    }


    checkIfMember(guild_id) {
        if(!guild_id){
            guild_id = this.guildId;
        }
        return new Promise(async (resolve) => {
            if(guild_id){
                let members = await this.fetchGuildMembers(guild_id);
                if(members){
                    const member = members.get(this.userId);
                    if(member){
                        return resolve(true);
                    } else {
                        return resolve(false);
                    }
                } else {
                    return resolve(false);
                }
            } else {
                for(let d = 0, dlen = discords.length; d < dlen; d++){
                    const discord = discords[d];
                    let members = await this.fetchGuildMembers(discord.id);
                    if (members) {
                        const member = members.get(this.userId);
                        if (member){
                            return resolve(true);
                        } else {
                            return resolve(false);
                        }
                    } else {
                        return resolve(true);
                    }
                }
            }
        });
    }


    assignDonorRole() {
        return new Promise((resolve) => {
            const member = client.guilds.cache.get(this.guildId).members.cache.get(this.userId);
            if (!member) {
                return resolve(false);
            } else if (!member.roles.cache.has(this.donorRole.toString())) {
                member.roles.add(this.donorRole);
                console.log(`[MapJS] [${getTime()}] [services/discord.js] Assigned donor role to ${this.userName} (${this.userId}).`);
                return resolve(true);
            } else {
                return resolve(false);
            }
        });
    }


    removeDonorRole() {
        return new Promise((resolve) => {
            const member = client.guilds.cache.get(this.guildId.toString()).members.cache.get(this.userId.toString());
            if (!member) {
                return resolve(false);
            } else if (member.roles.cache.has(this.donorRole.toString())) {
                member.roles.remove(this.donorRole);
                console.log(`[MapJS] [${getTime()}] [services/discord.js] Removed donor role from ${this.userName} (${this.userId}).`);
                return resolve(true);
            } else {
                return resolve(false);
            }
        });
    }


    async sendChannelEmbed(channel_id, color, title, body) {
        if(channel_id){
            const user = await client.users.fetch(this.userId.toString());
            const channel = await client.channels.cache.get(channel_id.toString());
            if(channel){
                const embed = new Discord.MessageEmbed().setColor(color)
                    .setAuthor(user.username + ` (${user.id})`, user.displayAvatarURL())
                    .setTitle(title)
                    .setFooter(getTime('full'));
                if(body){
                    embed.setDescription(body);
                }
                channel.send(embed).catch(error => {
                    if (error) {
                        console.error(`[MapJS] [${getTime()}] [services/discord.js]`, error);
                    } else {
                        return;
                    }
                });
            }
        }
    }


    async sendDmEmbed(color, title, body) {
        const user = await client.users.fetch(this.userId.toString());
        const embed = new Discord.MessageEmbed().setColor(color)
            .setAuthor(user.username + ` (${user.id})`, user.displayAvatarURL())
            .setTitle(title)
            .setFooter(getTime('full'));
        if(body){
            embed.setDescription(body);
        }
        user.send(embed).catch(error => {
            if (error) {
                console.error(`[MapJS] [${getTime()}] [services/discord.js]`, error);
            } else {
                console.log(`[MapJS] [${getTime()}] [services/discord.js] Sent '${title}' DM to ${user.username} (${user.id})`);
                return;
            }
        });
    }

    async sendMessage(channelId, message) {
        if (!channelId) {
            return;
        }
        const channel = await client.channels.cache
            .get(channelId)
            .fetch();
        if (channel && message) {
            channel.send(message);
        }
    }
}

function getTime (type) {
    switch (type) {
        case 'full':
            return moment().format('dddd, MMMM Do h:mmA');
        case 'unix':
            return moment().unix();
        case 'ms':
            return moment().valueOf();
        default:
            return moment().format('hh:mmA');
    }
}

if(config.open_map === true){
    console.error(`[MapJS] [${getTime()}] [services/discord.js] WARNING: Open Map is set to 'true'.`);
}


module.exports = DiscordClient;
