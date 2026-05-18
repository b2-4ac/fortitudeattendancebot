import 'dotenv/config';
import { Bot, Context } from "grammy";
import cron from "node-cron";
import { conversations, createConversation } from "@grammyjs/conversations"
import { addMember,
        getMember,
        getMemberRole,
        makeCommitteeMember,
        getNameById,
        applyLeave,
        getPendingLeaves,
        approveLeave,
        rejectLeave,
        getOffDays,
        getAllMembers,
        getAbsencesByName,
        getAbsencesByDate,
        getLeaveIdByUserandDate,
        cancelLeave } from "./database.js";
import { MemberNotFoundError } from './errortypes.js';

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
        var userDetails = await getMember(id);
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

function isSaturday(dateString) {
    const [day, month, year] = dateString.split("-");
    const IsoYmdString = year + "-" + month + "-" + day;
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

async function generateTrainingMessage() {
    console.log("Generating Training Message...");
    const today = new Date().toISOString().split("T")[0];
    const leaves = await getAbsencesByDate(today);

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

    var allMembers = await getAllMembers();
    var nameOnlyList = allMembers.map((member) => member.name);
    var presentMembers = nameOnlyList.filter((name) => !approvedLeavesArray.includes(name));
    var presentMembersString = `Present (${presentMembers.length}):\n`;
    for (const [index, name] of presentMembers.entries()) {
        presentMembersString += `${index + 1}. ${name}\n`;
    }

    var reportString = `<b> Attendance Report for ${today} </b>\n\n`
            + presentMembersString + "\n"
            + approvedLeavesString + "\n"
            + pendingLeavesString + "\n"
            + rejectedLeavesString + "\n";

    return reportString;
}

// ==================== Conversations ====================

async function applyLeaveConversation(conversation, ctx) {

    await ctx.reply("Please enter the date of requested leave in DD-MM-YYYY format\n\nEnter `exit` to terminate this transaction");

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

    await ctx.reply("Please state the reason for your absence\n\nEnter `exit` to terminate this transaction");
    var reasonCtx = await conversation.waitFor("message:text");
    var reason = reasonCtx.message.text;

    if (reason == "exit") {
        ctx.reply("Terminated");
        return;
    }

    const id = ctx.from.id;

    try {
        const name = await getNameById(id);
        await applyLeave(id, name, date, reason);
        await ctx.reply("Your leave application has been sent for approval");
        await bot.api.sendMessage(fortitudeCommChatId,
                `<b>New Leave Application</b>\n`
                + `Name: ${name}\n`
                + `Date: ${date}\n`
                + `Reason: ${reason}`,
                { message_thread_id: fortitudeCommAttendanceMessageThreadId, parse_mode: 'HTML'}
        )
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

        var idx;
        try {
            if (reply.match(approveRegex)) {
                idx = parseInt(reply.match(approveRegex)[1]);
                const leaveId = indexToId.get(idx);
                await approveLeave(leaveId);
                const leave = pendingLeaves[idx - 1];
                await bot.api.sendMessage(leave.telegram_id, 
                        `Your leave on ${leave.date} has been approved`);
            } else {
                idx = parseInt(reply.match(rejectRegex)[1]);
                const leaveId = indexToId.get(idx);
                await rejectLeave(leaveId);
                const leave = pendingLeaves[idx - 1];
                await bot.api.sendMessage(leave.telegram_id, 
                        `Your leave on ${leave.date} has been rejected`);
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
        const leave = await getLeaveIdByUserandDate(userId, dateString);
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

// ==================== Command List ====================

cron.schedule("40 7 * * 6", async () => {
    try {
        console.log("Time: ", new Date().toISOString());
        console.log("Starting Cron Job...");
        const dailyReport = await generateTrainingMessage();
        await bot.api.sendMessage(
                fortitudeCommChatId,
                dailyReport,
                { message_thread_id: fortitudeCommAttendanceMessageThreadId , parse_mode: 'HTML'});
    } catch (err) {
        console.log(err);
    }
})

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

bot.command("getrole", async (ctx) => {
    var name = ctx.from.first_name;
    var id = ctx.from.id;
    try {
        var response = await getMemberRole(name);
    } catch (err) {
        response = err.message;
    }

    ctx.reply(response);
})

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
    const startDate = new Date(today.getFullYear(), 0, 1).toISOString().split("T")[0];
    const endDate = today.toISOString().split("T")[0];

    const trainingDays = await countTrainings();
    let memberList = await getAllMembers();
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

bot.start();
