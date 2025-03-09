// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAcsYRpUk2C0p5tfClIFk69IOFAOFRwR_A",
  authDomain: "premierfix-291fb.firebaseapp.com",
  projectId: "premierfix-291fb",
  storageBucket: "premierfix-291fb.appspot.com",
  messagingSenderId: "246325431082",
  appId: "1:246325431082:web:8f4048bc6100b65a0a2c53",
  measurementId: "G-ESTSGQ8V6G"
};

// Global instances
let firebaseApp;
let firestoreInstance;
let authInstance;
let storageInstance;
let initialized = false;

// Initialize Firebase immediately when the script loads
(function initializeFirebaseCore() {
  try {
    if (!firebase.apps.length) {
      firebaseApp = firebase.initializeApp(firebaseConfig);
    } else {
      firebaseApp = firebase.app();
    }
    
    firestoreInstance = firebase.firestore();
    
    // Configure Firestore settings only once
    firestoreInstance.settings({
      cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED,
      ignoreUndefinedProperties: true
    });

    // Enable offline persistence
    firestoreInstance.enablePersistence({ synchronizeTabs: true })
      .catch(err => {
        if (err.code === 'failed-precondition') {
          console.warn('Multiple tabs open, persistence can only be enabled in one tab at a time.');
        } else if (err.code === 'unimplemented') {
          console.warn('The current browser does not support all of the features required to enable persistence');
        }
      });

    authInstance = firebase.auth();
    storageInstance = firebase.storage();
    initialized = true;
    console.log("Firebase initialized successfully");
  } catch (error) {
    console.error("Error initializing Firebase:", error);
  }
})();

// Get Firebase instances without reinitializing
function getFirebaseInstances() {
  if (!initialized) {
    console.warn("Firebase not initialized yet, using default instances");
    return {
      db: firebase.firestore(),
      auth: firebase.auth(),
      storage: firebase.storage()
    };
  }
  
  return {
    db: firestoreInstance,
    auth: authInstance,
    storage: storageInstance
  };
}

// Anonymous authentication
async function signInAnonymously() {
  try {
    const { auth } = getFirebaseInstances();
    const userCredential = await auth.signInAnonymously();
    console.log("Signed in anonymously:", userCredential.user.uid);
    return userCredential.user;
  } catch (error) {
    console.error("Error signing in anonymously:", error);
    return null;
  }
}

// Save issue to Firestore
async function saveIssue(issueData) {
  try {
    const { db } = getFirebaseInstances();
    const user = await signInAnonymously();

    if (!user) {
      throw new Error("Authentication failed");
    }

    // Add user ID and timestamps
    const enhancedData = {
      ...issueData,
      userId: user.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      status: "Pending"
    };

    try {
      const docRef = await db.collection("issues").add(enhancedData);
      console.log("Issue saved with ID:", docRef.id);
      return docRef.id;
    } catch (networkError) {
      console.error("Network error while saving issue:", networkError);
      
      // Store locally if online save fails
      const offlineId = "offline_" + new Date().getTime();
      localStorage.setItem(`issue_${offlineId}`, JSON.stringify(enhancedData));
      console.log("Issue saved locally with ID:", offlineId);
      
      return offlineId;
    }
  } catch (error) {
    console.error("Error saving issue:", error);
    throw error;
  }
}

// Get issues from Firestore
async function getIssues(filters = {}) {
  try {
    const { db } = getFirebaseInstances();
    let query = db.collection("issues");
    
    // Apply filters
    if (filters.category && filters.category !== "") {
      query = query.where("category", "==", filters.category);
    }
    
    if (filters.status && filters.status !== "") {
      query = query.where("status", "==", filters.status);
    }
    
    if (filters.search && filters.search !== "") {
      // Client-side filtering for text search (Firestore doesn't support text search directly)
      const searchLower = filters.search.toLowerCase();
      const snapshot = await query.get();
      const issues = [];
      
      snapshot.forEach(doc => {
        const data = doc.data();
        const description = (data.description || "").toLowerCase();
        const location = (data.location || "").toLowerCase();
        const roomNumber = (data.roomNumber || "").toLowerCase();
        const authorName = (data.authorName || "").toLowerCase();
        
        if (description.includes(searchLower) || 
            location.includes(searchLower) || 
            roomNumber.includes(searchLower) || 
            authorName.includes(searchLower)) {
          issues.push({
            id: doc.id,
            ...data
          });
        }
      });
      
      // Apply date filters client-side
      let filteredIssues = issues;
      if (filters.dateFrom) {
        const fromDate = new Date(filters.dateFrom);
        filteredIssues = filteredIssues.filter(issue => {
          const createdAt = issue.createdAt ? new Date(issue.createdAt.toDate()) : null;
          return createdAt && createdAt >= fromDate;
        });
      }
      
      if (filters.dateTo) {
        const toDate = new Date(filters.dateTo);
        toDate.setHours(23, 59, 59, 999); // End of day
        filteredIssues = filteredIssues.filter(issue => {
          const createdAt = issue.createdAt ? new Date(issue.createdAt.toDate()) : null;
          return createdAt && createdAt <= toDate;
        });
      }
      
      // Apply sorting
      if (filters.sortDirection) {
        filteredIssues.sort((a, b) => {
          const dateA = a.createdAt ? new Date(a.createdAt.toDate()) : new Date(0);
          const dateB = b.createdAt ? new Date(b.createdAt.toDate()) : new Date(0);
          
          return filters.sortDirection === 'asc' ? dateA - dateB : dateB - dateA;
        });
      }
      
      // Apply pagination
      if (filters.page && filters.limit) {
        const startIndex = (filters.page - 1) * filters.limit;
        const endIndex = startIndex + filters.limit;
        return {
          issues: filteredIssues.slice(startIndex, endIndex),
          total: filteredIssues.length
        };
      }
      
      return {
        issues: filteredIssues,
        total: filteredIssues.length
      };
    }
    
    // Apply date filters (if no text search)
    if (filters.dateFrom) {
      query = query.where("createdAt", ">=", new Date(filters.dateFrom));
    }
    
    if (filters.dateTo) {
      const toDate = new Date(filters.dateTo);
      toDate.setHours(23, 59, 59, 999); // End of day
      query = query.where("createdAt", "<=", toDate);
    }
    
    // Apply sorting
    if (filters.sortDirection) {
      query = query.orderBy("createdAt", filters.sortDirection);
    } else {
      query = query.orderBy("createdAt", "desc"); // Default sort
    }
    
    // Get total count (for pagination)
    const countSnapshot = await query.get();
    const total = countSnapshot.size;
    
    // Apply pagination
    if (filters.page && filters.limit) {
      const startIndex = (filters.page - 1) * filters.limit;
      query = query.limit(filters.limit);
      
      if (startIndex > 0) {
        // Get the last document from the previous page
        const prevPageQuery = query.limit(startIndex);
        const prevPageSnapshot = await prevPageQuery.get();
        const lastDoc = prevPageSnapshot.docs[prevPageSnapshot.docs.length - 1];
        
        if (lastDoc) {
          query = query.startAfter(lastDoc);
        }
      }
    }
    
    const snapshot = await query.get();
    const issues = [];
    
    snapshot.forEach(doc => {
      issues.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    // Check for offline issues
    const offlineIssues = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith('issue_offline_')) {
        try {
          const issueData = JSON.parse(localStorage.getItem(key));
          offlineIssues.push({
            id: key.replace('issue_', ''),
            ...issueData,
            _isOffline: true
          });
        } catch (e) {
          console.error('Error parsing offline issue:', e);
        }
      }
    }
    
    // Combine online and offline issues
    const allIssues = [...issues, ...offlineIssues];
    
    return {
      issues: allIssues,
      total: total + offlineIssues.length
    };
  } catch (error) {
    console.error("Error getting issues:", error);
    
    // Fallback to local storage if online fetch fails
    const offlineIssues = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith('issue_')) {
        try {
          const issueData = JSON.parse(localStorage.getItem(key));
          offlineIssues.push({
            id: key.replace('issue_', ''),
            ...issueData,
            _isOffline: true
          });
        } catch (e) {
          console.error('Error parsing offline issue:', e);
        }
      }
    }
    
    return {
      issues: offlineIssues,
      total: offlineIssues.length
    };
  }
}

// Update issue status
async function updateIssueStatus(issueId, newStatus) {
  try {
    // Check if it's an offline issue
    if (issueId.startsWith('offline_')) {
      const key = `issue_${issueId}`;
      const issueData = JSON.parse(localStorage.getItem(key));
      
      if (issueData) {
        issueData.status = newStatus;
        issueData.updatedAt = new Date().toISOString();
        localStorage.setItem(key, JSON.stringify(issueData));
        return true;
      }
      return false;
    }
    
    // Online issue
    const { db } = getFirebaseInstances();
    await db.collection("issues").doc(issueId).update({
      status: newStatus,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    return true;
  } catch (error) {
    console.error("Error updating issue status:", error);
    return false;
  }
}

// Delete issue
async function deleteIssue(issueId) {
  try {
    // Check if it's an offline issue
    if (issueId.startsWith('offline_')) {
      const key = `issue_${issueId}`;
      localStorage.removeItem(key);
      return true;
    }
    
    // Online issue
    const { db } = getFirebaseInstances();
    await db.collection("issues").doc(issueId).delete();
    
    return true;
  } catch (error) {
    console.error("Error deleting issue:", error);
    return false;
  }
}

// Export functions
window.firebaseService = {
  saveIssue,
  getIssues,
  updateIssueStatus,
  deleteIssue
}; 