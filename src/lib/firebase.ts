import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore, collection, addDoc, getDocs, query, where, orderBy, doc, updateDoc, Timestamp, deleteDoc, getDoc } from 'firebase/firestore';
import { SentenceNote } from '../types';

// Load from public environment variables if Vite injected them, else from the JSON directly via a build step.
// For AI Studio apps, we can fetch from an internal endpoint or import the config json if it's in src.
// Since firebase-applet-config.json is in root, we can't directly import it from src easily without path aliases or moving it.
// Wait, AI studio provides VITE_FIREBASE_ config or we can just import the json directly.
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

const provider = new GoogleAuthProvider();

export const loginWithGoogle = () => signInWithPopup(auth, provider);
export const logout = () => signOut(auth);

// Firestore operations
export const notesCollection = collection(db, 'notes');

export const saveNote = async (note: Omit<SentenceNote, 'id'>) => {
  const docRef = await addDoc(notesCollection, note);
  return { ...note, id: docRef.id };
};

export const getUserNotes = async (userId: string): Promise<SentenceNote[]> => {
  const q = query(notesCollection, where('userId', '==', userId), orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SentenceNote));
};

export const updateNote = async (id: string, updates: Partial<SentenceNote>) => {
  const noteRef = doc(db, 'notes', id);
  await updateDoc(noteRef, updates);
};

export const deleteNote = async (id: string) => {
  const noteRef = doc(db, 'notes', id);
  await deleteDoc(noteRef);
};
