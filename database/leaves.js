import 'dotenv/config';
import supabase from '../config/supabase.js';
import { DuplicateLeaveError } from '../errortypes.js'

export async function applyLeave(id, name, date, reason, batchId) {
    const { error } = await supabase
        .from('leaves')
        .insert({telegram_id: id, name: name, date: date, reason: reason, batch_id: batchId});

    if (error) {
        if (error.code = '23505') {
            throw new DuplicateLeaveError("Leave already applied on this day");
        } else {
            throw new Error(error.message);
        }
    }
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

export async function approveLeave(batchId) {
    const { error } = await supabase
        .from('leaves')
        .update({status: "APPROVED"})
        .eq('batch_id', batchId)

    if (error) {
        throw new Error(error.message);
    }
}

export async function rejectLeave(batchId) {
    const { error } = await supabase
        .from('leaves')
        .update({status: "REJECTED"})
        .eq('batch_id', batchId)

    if (error) {
        throw new Error(error.message);
    }
}

export async function markAbsent(id, name, date) {
    const { error } = await supabase
        .from('leaves')
        .insert({telegram_id: id, name: name, date: date, status: 'ABSENT'});

    if (error) {
        throw new Error(error.message);
    }
}

export async function getLeaveById(leaveId) {
    const { data, error } = await supabase
        .from('leaves')
        .select()
        .eq('id', leaveId)
        .single()

    if (error) {
        throw new Error(error.message);
    }

    return data;
}

export async function getLeavesByBatchId(batchId) {
    const { data, error } = await supabase
        .from('leaves')
        .select()
        .eq('batch_id', batchId)

    if (error) {
        throw new Error(error.message);
    }

    return data;
}

export async function getLeaveByUserIdAndDate(id, dateString) {
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

export async function getPendingLeaves() {
    const { data, error } = await supabase
        .from('leaves')
        .select('id, batch_id, telegram_id, name, date, reason')
        .eq('status', 'PENDING')

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
        .or('status.eq.APPROVED, status.eq.ABSENT')
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
