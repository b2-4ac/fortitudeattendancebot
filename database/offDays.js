import 'dotenv/config';
import supabase from '../config/supabase.js';

export async function getOffDays() {
    const { data, error } = await supabase
        .from('off_days')
        .select('date');

    if (error) {
        throw new Error(error.message);
    }

    return data;
}
