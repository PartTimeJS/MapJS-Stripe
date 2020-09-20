/* eslint-disable no-async-promise-executor */
/* global BigInt */
'use strict';

const config = require('../services/config.js');
const discords = require('../configs/discords.json').discords;

const DiscordOauth2 = require('discord-oauth2');
const oauth = new DiscordOauth2();

const Discord = require('discord.js');
const client = new Discord.Client();

if (config.discord.enabled) {
    client.on('ready', async () => {
        console.log(`Logged in as ${client.user.tag}!`);
        client.user.setPresence({ activity: { name: config.discord.status, type: 3 } });
    });
  
    client.login(config.discord.botToken);
}

class DiscordClient {
    //static instance = new DiscordClient();

    constructor(user) {
        this.accessToken = user.access_token;
        this.userId = user.user_id;
        this.username = user.username;
        this.guildId = user.guild_id;
        this.guildName = user.guild_name;
        this.donorRole = user.donor_role;
        this.email = user.email;
    }

    setUserInfo(user){
        this.userId = user.user_id;
        this.username = user.username;
        this.guildId = user.guild_id;
        this.guildName = user.guild_name;
        this.email = user.email;
    }

    setUserId(id){
        this.userId = id;
    }

    setAccessToken(token) {
        this.accessToken = token;
    }

    async getUser() {
        return await oauth.getUser(this.accessToken);
    }

    async getGuilds() {
        const guilds = await oauth.getUserGuilds(this.accessToken);
        const guildIds = Array.from(guilds, x => BigInt(x.id).toString());
        return guildIds;
    }

    async getUserRoles(guildId) {
        try {
            const members = await client.guilds.cache
                .get(guildId)
                .members
                .fetch();
            const member = members.get(this.userId);
            const roles = member.roles.cache
                .filter(x => BigInt(x.id).toString())
                .keyArray();
            return roles;
        } catch (e) {
            console.error('Failed to get roles in guild', guildId, 'for user', this.userId);
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
        if (config.discord.allowedUsers.includes(this.userId)) {
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


    joinGuild(guild_id){
        client.users.fetch(this.userId).then((user) => {
            let options = {
                'accessToken': this.accessToken
            };
            client.guilds.cache.get(guild_id).addMember(user, options);
            return true;
        });
    }


    async guildMemberCheck(host){
        let discord = false;
        for(let d = 0, dlen = discords.length; d < dlen; d++){
            if(host.includes(discords[d].subdomain + '.')){
                discord = discords[d]; break;
            }
        }
        if(discord){
            let members = await this.fetchGuildMembers(discord.id);
            if (members) {
                const member = members.get(this.userId);
                if (member){
                    return true;
                } else {
                    console.error('Joining ' + this.userId + ' to ' + discord.name + ' discord.');
                    //this.joinGuild(discord.id)
                    //return false;
                }
            } else {
                return false;
            }
        } else {
            return false;
        }
    }


    fetchGuildMembers(guild_id){
        return new Promise(async (resolve) => {
            const members = await client.guilds.cache
                .get(guild_id)
                .members
                .fetch();
            if(members){
                return resolve(members);
            } else {
                console.error('unable to fetch members for ' + guild_id + '.');
                return resolve(false);
            }
        });
    }


    fetchGuildDonors(){
        return new Promise(async (resolve) => {
            const guild = await client.guilds.cache
                .get(this.guildId);
            const members = guild.roles.cache
                .find(role => role.id === this.roleId)
                .members
                .map(m => m);
            return resolve(members);
        });
    }


    fetchAllMembersArray(){
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


    checkIfMember(guild_id){
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
            return moment().format('dddd, MMMM Do  h:mmA');
        case 'unix':
            return moment().unix();
        case 'ms':
            return moment().valueOf();
        default:
            return moment().format('h:mmA');
    }
}


module.exports = DiscordClient;
