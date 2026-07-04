import 'dotenv/config';
import supabase from '../config/supabase.js';
import { DuplicateMemberError, MemberNotFoundError } from '../errortypes.js'

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

export async function getIdByName(name) {
    const { data, error } = await supabase
        .from('members')
        .select('telegram_id')
        .eq('name', name)
        .single();

    if (error) {
        throw new Error(error.message);
    }

    return data.telegram_id;
}

export async function getMemberById(id) {
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

export async function getAllMemberNames() {
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
