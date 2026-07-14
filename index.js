import 'dotenv/config';

import { Bot, InlineKeyboard } from "grammy";
import { conversations, createConversation } from "@grammyjs/conversations"

import cron from "node-cron"

import {
    addMember,
    getIdByName,
    getMemberById,
    getAllMemberNames,
    getMemberRole,
    makeCommitteeMember 
} from "./database/member.js"
import { 
    applyLeave,
    cancelLeave,
    approveLeave,
    rejectLeave,
    markAbsent,
    getLeaveById,
    getLeaveByUserIdAndDate,
    getPendingLeaves,
    getAbsencesByName,
    getAbsencesByDate 
} from "./database/leaves.js"
import { getOffDays } from "./database/offDays.js"
import { MemberNotFoundError } from './errortypes.js'

const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
const fortitudeCommChatId = process.env.FORTITUDE_COMM_CHAT_ID;
const fortitudeCommAttendanceMessageThreadId = process.env.FORTITUDE_COMM_ATTENDANCE_MESSAGE_THREAD_ID;

const bot = new Bot(telegramBotToken);
bot.use(conversations())

const dateRegex = /^(0[1-9]|[12][0-9]|3[01])-(0[1-9]|1[02])-\d{4}$/;
const approveRegex = /^approve\s+(\d+)$/;
const rejectRegex = /^reject\s+(\d+)$/;

// ==================== Helper Methods ====================

async function isValidUser(id) {
    try {
        var userDetails = await getMemberById(id);
    } catch (err) {
        if (err instanceof MemberNotFoundError) {
            return false;
        } else {
            throw new Error(err.message);
        }
    }

    return true;
}

async function isAuthorisedUser(id) {
    try {
        var isValid = await isValidUser(id);
        if (!isValid) {
            return false;
        }
        var userRole = await getMemberRole(id);
        if (userRole == 'MEMBER') {
            return false;
        }
        return true;
    } catch (err) {
        throw new Error(err.message);
    }
}

async function sendToComm(message) {
    await bot.api.sendMessage(
            fortitudeCommChatId,
            message,
            { message_thread_id: fortitudeCommAttendanceMessageThreadId,
                    parse_mode: 'HTML'});
}

function convertToEnCa(ddmmyyyyString) {
    const [day, month, year] = ddmmyyyyString.split("-");
    const enCaString = year + "-" + month + "-" + day;
    return enCaString;
}

function isSaturday(dateString) {
    const IsoYmdString = convertToEnCa(dateString)
    const leaveDate = new Date(IsoYmdString);
    return leaveDate.getDay() == 6;
}

async function countTrainings() {
    const today = new Date();
    const currentYear = today.getFullYear();

    const offDays = await getOffDays();
    const offDaysSet = new Set(offDays.map((d) => d.date));

    let curr = new Date(currentYear, 0, 1);
    let trainingCount = 0;

    while (curr < today) {
        if (curr.getDay() == 6) {
            const formattedDate = curr.toISOString().split("T")[0];
            if (!offDaysSet.has(formattedDate)) {
                trainingCount++;
            }
        }
        curr.setDate(curr.getDate() + 1);
    }
    return trainingCount;
}

async function generateTrainingMessage(date) {
    console.log("(INFO) ", "Generating Training Message...");
    const leaves = await getAbsencesByDate(date);

    var approvedLeavesArray = [];
    var pendingLeavesArray = [];
    var rejectedLeavesArray = [];

    for (const leave of leaves) {
        if (leave.status == "APPROVED") {
            approvedLeavesArray.push(leave.name);
        } else if (leave.status == "PENDING") {
            pendingLeavesArray.push(leave.name);
        } else if (leave.status == "REJECTED") {
            rejectedLeavesArray.push(leave.name);
        } else {
            return "An error has occurred";
        }
    }

    var approvedLeavesString = `Approved Leaves (${approvedLeavesArray.length}):\n`
    for (const [ index, name ] of approvedLeavesArray.entries()) {
        approvedLeavesString += `${index + 1}. ${name}\n`;
    }
    var pendingLeavesString = `Pending Leaves (${pendingLeavesArray.length}):\n`
    for (const [ index, name ] of pendingLeavesArray.entries()) {
        pendingLeavesString += `${index + 1}. ${name}\n`;
    }
    var rejectedLeavesString = `Rejected Leaves (${rejectedLeavesArray.length}):\n`
    for (const [ index, name ] of rejectedLeavesArray.entries()) {
        rejectedLeavesString += `${index + 1}. ${name}\n`;
    }

    var allMembers = await getAllMemberNames();
    var nameOnlyList = allMembers.map((member) => member.name);
    var presentMembers = nameOnlyList.filter((name) => !approvedLeavesArray.includes(name));
    var presentMembersString = `Present (${presentMembers.length}):\n`;
    for (const [index, name] of presentMembers.entries()) {
        presentMembersString += `${index + 1}. ${name}\n`;
    }

    var reportString = `<b> Attendance Report for ${date} </b>\n\n`
            + presentMembersString + "\n"
            + approvedLeavesString + "\n"
            + pendingLeavesString + "\n"
            + rejectedLeavesString + "\n";

    return reportString;
}

// ==================== Conversations ====================

async function applyLeaveConversation(conversation, ctx) {

    await ctx.reply("Please enter the date of requested leave in DD-MM-YYYY format\n\n"
            + "Enter `exit` to terminate this transaction");

    while (true) {
        var dateCtx = await conversation.waitFor("message:text");
        var date = dateCtx.message.text;

        console.log("Date Entered: ", date);

        if (date == "exit") {
            ctx.reply("Terminated");
            return;
        }

        if (dateRegex.test(date) && isSaturday(date)) {
            break;
        }
        await ctx.reply("Invalid date entered. Please try again.");
    }

    await ctx.reply("Please state the reason for your absence\n\nEnter `exit` to terminate this transaction");
    var reasonCtx = await conversation.waitFor("message:text");
    var reason = reasonCtx.message.text;

    console.log("Reason Entered: ", reason);

    if (reason == "exit") {
        ctx.reply("Terminated");
        return;
    }

    const id = ctx.from.id;

    try {
        // Retrieve Applicant Name
        const member = await getMemberById(id);
        const name = member.name;

        // Apply Leave in Database
        await applyLeave(id, name, date, reason);
        await ctx.reply("Your leave application has been sent for approval");
        const newLeave = await getLeaveByUserIdAndDate(id, date);

        // Notify Committee
        const keyboard = new InlineKeyboard()
                .text("Approve", `approve:${newLeave.id}`)
                .text("Reject", `reject:${newLeave.id}`);
        await bot.api.sendMessage(fortitudeCommChatId,
                `<b>New Leave Application</b>\n`
                + `Name: ${name}\n`
                + `Date: ${date}\n`
                + `Reason: ${reason}`,
                { message_thread_id: fortitudeCommAttendanceMessageThreadId,
                        parse_mode: 'HTML',
                        reply_markup: keyboard}
        );
    } catch (err) {
        await ctx.reply(err.message);
    }
}
bot.use(createConversation(applyLeaveConversation));

async function viewPendingLeavesConversation(conversation, ctx) {
    const indexToId = new Map()
    const pendingLeaves = await conversation.external(() => getPendingLeaves());

    while (true) {
        var leaveList = "";
        if (pendingLeaves.length == 0) {
            ctx.reply("There are no pending leave applications.")
            return;
        }
        for (var [index, leave] of pendingLeaves.entries()) {
            leaveList += `${index + 1}.\n`
                    + `Name: ${leave.name}\n`
                    + `Date: ${leave.date}\n`
                    + `Reason: ${leave.reason}\n`
            indexToId.set(index + 1, leave.id);
        }
        await ctx.reply("Pending Leaves:\n\n"
                + leaveList
                + "\nEnter `approve <index>` to approve leaves\n"
                + "Enter `reject <index> to reject leaves\n"
                + "Enter `exit` to exit conversation.");

        var replyCtx = await conversation.waitFor("message:text");
        var reply = replyCtx.message.text;
        while (reply != "exit" && !reply.match(approveRegex) && !reply.match(rejectRegex)) {
            ctx.reply("Invalid input. Try again.");
            replyCtx = await conversation.waitFor("message:text");
            reply = replyCtx.message.text;
        }

        if (reply == "exit") {
            ctx.reply("Exiting Conversation");
            return;
        }

        try {
            if (reply.match(approveRegex)) {
                var idx = parseInt(reply.match(approveRegex)[1]);
                const leaveId = indexToId.get(idx);
                await approveLeave(leaveId);
                const leave = pendingLeaves[idx - 1];
                await conversation.external(() => {
                    bot.api.sendMessage(leave.telegram_id, 
                        `Your leave on ${leave.date} has been approved`)
                });
            } else {
                var idx = parseInt(reply.match(rejectRegex)[1]);
                const leaveId = indexToId.get(idx);
                await rejectLeave(leaveId);
                const leave = pendingLeaves[idx - 1];
                await conversation.external(() => {
                    bot.api.sendMessage(leave.telegram_id, 
                        `Your leave on ${leave.date} has been rejected`)
                });
            }
            pendingLeaves.splice(idx - 1, 1);
            indexToId.clear();
        } catch (err) {
            ctx.reply(err.message);
            return;
        }
    }
}
bot.use(createConversation(viewPendingLeavesConversation));

async function cancelLeaveConversation(conversation, ctx) {
    await ctx.reply("Please indicate the date of leave to cancel in DD-MM-YYYY format: \n\n"
            + "Enter `exit` to terminate this transaction."
    );

    while (true) {
        var dateCtx = await conversation.waitFor("message:text");
        var date = dateCtx.message.text;

        if (date == "exit") {
            ctx.reply("Terminated");
            return;
        }

        if (dateRegex.test(date) && isSaturday(date)) {
            break;
        }
        await ctx.reply("Invalid date entered. Please try again.");
    }

    try {
        var userId = ctx.from.id;
        const leave = await getLeaveByUserIdAndDate(userId, date);
        await cancelLeave(leave.id);
        await ctx.reply("Leave Cancelled");

        var commNotif = `<b> New Cancelled Leave </b>\n`
                + `${leave.name} has cancelled their leave on ${leave.date}`

        await sendToComm(commNotif);
    } catch (err) {
        ctx.reply(err.message);
        return;
    }
}
bot.use(createConversation(cancelLeaveConversation));

async function markAbsentConversation(conversation, ctx) {
    await ctx.reply("Enter the name of the member to mark as absent: \n\n"
            + "Enter `exit` to terminate this conversation")

    var memberNamelist = await conversation.external(() => getAllMemberNames());
    memberNamelist = memberNamelist.map((m) => m.name);

    while (true) {
        var nameCtx = await conversation.waitFor("message:text");
        var name = nameCtx.message.text;

        if (name == "exit") {
            await ctx.reply("Terminated");
            return;
        }

        name = name.toUpperCase();
        if (!memberNamelist.includes(name)) {
            ctx.reply("Invalid Member. Try Again");
            continue;
        } else {
            break;
        }
    }

    await ctx.reply("Enter the date of training during which the member was missing in DD-MM-YYYY format: \n\n"
            + "Enter `exit` to terminate this conversation.")

    while (true) {
        var dateCtx = await conversation.waitFor("message:text");
        var date = dateCtx.message.text;

        if (date == "exit") {
            await ctx.reply("Terminated");
            return;
        }

        if (!dateRegex.test(date) || !isSaturday(date)) {
            await ctx.reply("Invalid Date Format");
            continue;
        } else {
            break;
        }
    }

    try {
        var userId = await getIdByName(name);
        await markAbsent(userId, name, date);
        await ctx.reply(`Marked ${name} as absent on ${date}`);
        await bot.api.sendMessage(userId,
                `You have missed training on ${date} without reason and are marked as absent`);
    } catch (err) {
        ctx.reply(err.message);
        return;
    }
}
bot.use(createConversation(markAbsentConversation));

// ==================== Handle Button Callback ====================

bot.callbackQuery(/^approve:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const leaveId = ctx.match[1];
    try {
        const targetLeave = await getLeaveById(leaveId);
        await approveLeave(leaveId);
        bot.api.sendMessage(targetLeave.telegram_id, `Your leave on ${targetLeave.date} has been approved`)
        ctx.editMessageText(
            "<b>APPROVED</b>\n"
            + `Name: ${targetLeave.name}\n`
            + `Date: ${targetLeave.date}\n`
            + `Reason: ${targetLeave.reason}`,
            { reply_markup: undefined, parse_mode: 'HTML' }
        );
    } catch (err) {
        ctx.reply(err.message)
    }
})

bot.callbackQuery(/^reject:(.+)$/, async (ctx) => {
    const leaveId = ctx.match[1];
    try {
        const targetLeave = await getLeaveById(leaveId);
        await rejectLeave(leaveId);
        bot.api.sendMessage(targetLeave.telegram_id, `Your leave on ${targetLeave.date} has been rejected`)
        ctx.editMessageText(
            "<b>REJECTED</b>\n"
            + `Name: ${targetLeave.name}\n`
            + `Date: ${targetLeave.date}\n`
            + `Reason: ${targetLeave.reason}`,
            { reply_markup: undefined, parse_mode: 'HTML' }
        );
    } catch (err) {
        ctx.reply(err.message)
    }
})

// ==================== Scheduled Message ====================

cron.schedule("40 7 * * 6", async () => {
    try {
        console.log("Time: ", new Date().toString());
        console.log("Starting Cron Job...");
        const today = new Date().toLocaleDateString("en-CA", {timeZone: "Asia/Singapore"});
        const dailyReport = await generateTrainingMessage(today);
        await bot.api.sendMessage(
                fortitudeCommChatId,
                dailyReport,
                { message_thread_id: fortitudeCommAttendanceMessageThreadId , parse_mode: 'HTML'});
    } catch (err) {
        console.log(err);
    }
})

// ==================== Command List ====================

bot.command("register", async (ctx) => {
    var name = ctx.from.first_name;
    var id = ctx.from.id;

    var targetParams = ctx.match;
    if (targetParams == "") {
        bot.api.sendMessage(id, "Incorrect Command Format.");
        return;
    }
    const [targetId, targetName] = targetParams.split(/\s(.+)/);

    var response;

    try {
        var isAuthorised = await isAuthorisedUser(name);
        if (!isAuthorised) {
            bot.api.sendMessage(id, "You do not have the permissions for this command");
            return;
        }
        await addMember(targetName, targetId);
        response = `Successfully added new member: ${targetName}`;
    } catch (err) {
        response = err.message
    }

    ctx.reply(response);
})

// bot.command("getrole", async (ctx) => {
//     var name = ctx.from.first_name;
//     var id = ctx.from.id;
//     try {
//         var response = await getMemberRole(name);
//     } catch (err) {
//         response = err.message;
//     }

//     ctx.reply(response);
// })

bot.command("setcomm", async (ctx) => {
    var name = ctx.from.first_name;
    var id = ctx.from.id;
    var targetName = ctx.match;

    var response;

    if (targetName == "") {
        ctx.reply("Incorrect Command Format");
        return;
    }

    try {
        var isAuthorised = await isAuthorisedUser(id);
        if (!isAuthorised) {
            ctx.reply("You do not have the permissions for this command");
            return;
        }

        var targetRole = await getMemberRole(targetName);
        if (targetRole == "COMMITTEE") {
            response = `${targetName} is already in the committee`;
        } else {
            await makeCommitteeMember(targetName);
            response = `${targetName} has been added into the committee`;
        }
    } catch (err) {
        response = err.message
    }

    ctx.reply(response);
})

bot.command("applyleave", async (ctx) => {
    console.log("Time: ", new Date().toString());
    console.log("(INFO) ", "Leave Application Called");
    var id = ctx.from.id;
    try {
        var isValid = await isValidUser(id);
        if (!isValid) {
            ctx.reply("You are not a registered user");
            return;
        }
    } catch (err) {
        ctx.reply(err.message);
        return;
    }
    await ctx.conversation.enter("applyLeaveConversation");
})

bot.command("cancelleave", async (ctx) => {
    console.log("Time: ", new Date().toString());
    console.log("(INFO) ", "Leave Cancellation Called");
    var id = ctx.from.id;
    try {
        var isValid = await isValidUser(id);
        if (!isValid) {
            ctx.reply("You are not a registered user");
            return;
        }
    } catch (err) {
        ctx.reply(err.message);
        return;
    }
    await ctx.conversation.enter("cancelLeaveConversation");
})

bot.command("markabsent", async (ctx) => {
    var id = ctx.from.id;
    try {
        var isAuthorised = await isAuthorisedUser(id);
        if (!isAuthorised) {
            ctx.reply("You do not have the permissions for this command");
            return;
        }
    } catch (err) {
        ctx.reply(err.message);
        return;
    }
    await ctx.conversation.enter("markAbsentConversation");
})

bot.command("viewpending", async (ctx) => {
    var id = ctx.from.id;
    try {
        var isAuthorised = await isAuthorisedUser(id);
        if (!isAuthorised) {
            ctx.reply("You do not have the permissions for this command");
            return;
        }
    } catch (err) {
        ctx.reply(err.message);
        return;
    }
    await ctx.conversation.enter("viewPendingLeavesConversation");
})

bot.command("viewreport", async (ctx) => {
    const today = new Date();
    const startDate = new Date(today.getFullYear(), 0, 1).toLocaleDateString("en-CA", {timeZone: "Asia/Singapore"});
    const endDate = today.toLocaleDateString("en-CA", {timeZone: "Asia/Singapore"});

    const trainingDays = await countTrainings();
    let memberList = await getAllMemberNames();
    var attendanceList = await Promise.all(memberList.map( async (m) => {
        const allAbsences = await getAbsencesByName(m.name, startDate, endDate);
        const numAbsences = allAbsences.length;
        const daysPresent = trainingDays - numAbsences;
        return { name: m.name, present: daysPresent };
    }));

    attendanceList.sort((a, b) => b.present - a.present);

    var report = `<b>${today.getFullYear()} ATTENDANCE REPORT</b>\n\n`;

    for (const [index, member] of attendanceList.entries()) {
        report += `${index + 1}. ${member.name}: ${member.present}/${trainingDays} (${((member.present / trainingDays) * 100).toFixed(1)}%)\n`
    }

    ctx.reply(report, {parse_mode: 'HTML'});
})

bot.command("upcoming", async (ctx) => {
    var id = ctx.from.id;
    try {
        var isAuthorised = await isAuthorisedUser(id);
        if (!isAuthorised) {
            ctx.reply("You do not have the permissions for this command");
            return;
        }

        var curr = new Date();
        while (curr.getDay() != 6) {
            curr.setDate(curr.getDate() + 1);
        }

        const dateString = curr.toLocaleDateString("en-CA", {timeZone: "Asia/Singapore"});
        const report = await generateTrainingMessage(dateString);

        await ctx.reply(report, {parse_mode: "HTML"});
    } catch (err) {
        ctx.reply(err.message);
        return;
    }

})

bot.catch((err) => {
    console.log(err);
})

console.log("Bot starting")
bot.start();
console.log("Bot started")
