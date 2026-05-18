import 'dotenv/config';
import supabase from './config/supabase.js';
import { DuplicateLeaveError, DuplicateMemberError, MemberNotFoundError } from './errortypes.js'

export async function addMember(name, id) {
    const { error } = await supabase
        .from('members')
        .insert({telegram_id: id, name: name.toUpperCase()})

    if (error) {
        if (error.code == '23505') {
            throw new DuplicateMemberError("Member Already Exists!")
        } else {
            throw new Error(error.message);
        }
    }
}

export async function getNameById(id) {
    const { data, error } = await supabase
        .from('members')
        .select('name')
        .eq('telegram_id', id)
        .single();

    if (error) {
        if (error.code = 'PGRST116') {
            throw new MemberNotFoundError("The requested ID is not in the database")
        } else {
            throw new Error(error.message)
        }
    }

    return data.name;
}

export async function getMember(id) {
    const { data, error } = await supabase
        .from('members')
        .select()
        .eq('telegram_id', id)
        .single();

    if (error) {
        if (error.code = "PGRST116") {
            throw new MemberNotFoundError(`The requested member is not in the database`);
        } else {
            throw new Error(error.message);
        }
    }

    return data;
}

export async function getAllMembers() {
    const { data, error } = await supabase
        .from('members')
        .select('name');

    if (error) {
        throw new Error(error.message);
    }

    return data;
}

export async function getMemberRole(id) {
    const { data, error } = await supabase
        .from('members')
        .select('role')
        .eq('telegram_id', id)
        .single()

    if (error) {
        if (error.code == 'PGRST116') {
            throw new MemberNotFoundError(`The requested member is not in the database`);
        } else {
            throw new Error(error.message);
        }
    }

    return data.role;
}

export async function makeCommitteeMember(name) {

    const { error } = await supabase
        .from('members')
        .update({ role: "COMMITTEE"})
        .eq('name', name.toUpperCase())

    if (error) {
        throw new Error(error.message);
    }
}

export async function applyLeave(id, name, date, reason) {
    const { error } = await supabase
        .from('leaves')
        .insert({telegram_id: id, name: name, date: date, reason: reason});

    if (error) {
        if (error.code = '23505') {
            throw new DuplicateLeaveError("Leave already applied on this day");
        } else {
            throw new Error(error.message);
        }
    }
}

export async function getLeaveIdByUserandDate(id, dateString) {
    const { data, error } = await supabase
        .from('leaves')
        .select()
        .eq('telegram_id', id)
        .eq('date', dateString)
        .single();

    if (error) {
        throw new Error(error.message);
    }

    return data;
}

export async function cancelLeave(id) {
    const { error } = await supabase
        .from('leaves')
        .update({status: "CANCELLED"})
        .eq('id', id);

    if (error) {
        throw new Error(error.message);
    }
}

export async function getPendingLeaves() {
    const { data, error } = await supabase
        .from('leaves')
        .select('id, telegram_id, name, date, reason')
        .eq('status', 'PENDING')

    if (error) {
        throw new Error(error.message);
    }

    return data;
}

export async function approveLeave(id) {
    const { error } = await supabase
        .from('leaves')
        .update({status: "APPROVED"})
        .eq('id', id)

    if (error) {
        throw new Error(error.message);
    }
}

export async function rejectLeave(id) {
    const { error } = await supabase
        .from('leaves')
        .update({status: "REJECTED"})
        .eq('id', id)

    if (error) {
        throw new Error(error.message);
    }
}

export async function getOffDays() {
    const { data, error } = await supabase
        .from('off_days')
        .select('date');

    if (error) {
        throw new Error(error.message);
    }

    return data;
}

export async function getAbsencesByName(name, startDate, endDate) {
    const { data, error } = await supabase
        .from('leaves')
        .select()
        .eq('name', name)
        .eq('status', 'APPROVED')
        .gte('date', startDate)
        .lte('date', endDate)

    if (error) {
        throw new Error(error.message);
    }

    return data;
}

export async function getAbsencesByDate(date) {
    const { data, error } = await supabase
        .from('leaves')
        .select('name, status')
        .eq('date', date)

    if (error) {
        throw new Error(error.message);
    }

    return data;
}
